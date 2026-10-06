import { DecisionError, type DecisionRequest, type Resolved, type Result } from './types.js'
function fail(code: string): never { throw new DecisionError(code) }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
export function validateRequest(config: Resolved, request: DecisionRequest) {
  if (!object(request) || Object.keys(request).some(k => !['state', 'questions'].includes(k)) || request.state === undefined || !object(request.questions)) fail('invalid_request')
  const questions = Object.values(request.questions)
  if (!questions.length || questions.length > Math.min(config.model.maxQuestions ?? 64, 64) || Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024) fail('input_too_large')
  for (const q of questions) {
    if (!object(q) || Object.keys(q).some(k => !['type', 'instructions', 'criteria'].includes(k)) || !['choice', 'score', 'noul'].includes(q.type) || typeof q.instructions !== 'string' || !q.instructions.trim()) fail('invalid_request')
    if (q.type === 'noul' && q.criteria !== undefined) fail('invalid_request')
    if (!config.model.questionTypes.includes(q.type)) fail('unsupported_capability')
    if (q.type === 'choice') {
      if (!object(q.criteria) || Object.keys(q.criteria).length < 2 || Object.values(q.criteria).some(v => v !== null && typeof v !== 'string')) fail('invalid_request')
      if (Object.keys(q.criteria).length > (config.model.maxOptions ?? 255)) fail('input_too_large')
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some(v => typeof v !== 'string'))) fail('invalid_request')
  }
}
export function validateAnswers(request: DecisionRequest, data: unknown, nativeScore = false): Record<string, Record<string, unknown>> {
  if (!object(data) || typeof data.model !== 'string' || !object(data.answers)) fail('invalid_response')
  const answers = data.answers
  if (Object.keys(answers).length !== Object.keys(request.questions).length) fail('invalid_response')
  for (const [id, q] of Object.entries(request.questions)) {
    const a = answers[id]; if (!object(a) || a.type !== q.type) fail('invalid_response')
    if (q.type === 'noul') { if (!probability(a.noul)) fail('invalid_response'); continue }
    if (q.type === 'score' && nativeScore && a.probabilities === undefined) { if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > (q.criteria as string[]).length - 1 || !probability(a.confidence)) fail('invalid_response'); continue }
    const options = q.type === 'choice' ? Object.keys(q.criteria!) : (q.criteria as string[]).map((_, i) => String(i))
    if (!object(a.probabilities) || Object.keys(a.probabilities).length !== options.length || options.some(k => !probability(a.probabilities[k]))) fail('invalid_response')
    const sum = options.reduce((n, k) => n + a.probabilities[k], 0); if (Math.abs(sum - 1) > 0.01 || !probability(a.confidence)) fail('invalid_response')
    if (q.type === 'choice' && !options.includes(a.choice)) fail('invalid_response')
    if (q.type === 'score' && (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > options.length - 1)) fail('invalid_response')
  }
  return answers
}
export async function evaluateDecision(config: Resolved, request: DecisionRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Result> {
  validateRequest(config, request)
  if (config.provider.protocol === 'pi-native') { const { nativeDecisionClient } = await import('./native.js'); return nativeDecisionClient.evaluate(config, request, signal) }
  const start = Date.now(); const deadline = AbortSignal.timeout(config.provider.timeoutMs); const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    const response = await fetcher(config.provider.endpoint, { method: 'POST', redirect: 'error', signal: combined, headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) }, body: JSON.stringify({ ...request, ...(config.model.remoteModel ? { model: config.model.remoteModel } : {}) }) })
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'upstream_error')
    const reader = response.body?.getReader(); if (!reader) fail('invalid_response')
    let bytes = 0; const chunks: Uint8Array[] = []
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); fail('invalid_response') } chunks.push(part.value) }
    let data: any; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('invalid_response') }
    const answers = validateAnswers(request, data)
    if (combined.aborted) fail(signal?.aborted ? 'cancelled' : 'timeout')
    return { actualModel: data.model, providerId: config.provider.id, modelConfigId: config.model.id, revision: config.revision, latencyMs: Date.now() - start, answers, usage: data.usage ?? null, routing: data.routing, confidenceSemantics: config.model.confidenceSemantics }
  } catch (e) { if (signal?.aborted) fail('cancelled'); if (deadline.aborted) fail('timeout'); if (e instanceof DecisionError) throw e; fail('upstream_error') }
}
