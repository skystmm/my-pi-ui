import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { join } from 'node:path'
import { getAgentDir } from '../paths.js'
import { DecisionError, type Resolved, type DecisionRequest, type Result } from './types.js'
import { validateRequest, validateAnswers } from './client.js'

/** Pi owns catalog, request authentication and usage pricing; no chat session is created. */
export class NativeDecisionClient {
  constructor(private runtime: () => Promise<ModelRuntime> = () => ModelRuntime.create({
    modelsPath: join(getAgentDir(), 'models.json'), authPath: join(getAgentDir(), 'auth.json'),
    modelsStorePath: join(getAgentDir(), 'models-store.json'), allowModelNetwork: false, refreshOnCreate: false,
  })) {}

  async catalog() {
    const runtime = await this.runtime()
    if (runtime.getError()) throw new DecisionError('invalid_pi_config')
    return runtime.getModelsOfType('classifier').map(m => ({ provider: m.provider, id: m.id, name: m.name, api: m.api, contextWindow: m.contextWindow }))
  }

  async evaluate(config: Resolved, request: DecisionRequest, signal?: AbortSignal): Promise<Result> {
    validateRequest(config, request)
    const start = Date.now(), deadline = AbortSignal.timeout(config.provider.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      if (combined.aborted) throw new DecisionError('cancelled')
      const runtime = await this.runtime()
      if (runtime.getError()) throw new DecisionError('invalid_pi_config')
      const model = runtime.getModelOfType('classifier', config.provider.piProviderId ?? '', config.model.remoteModel ?? '')
      if (!model) throw new DecisionError('unknown_model')
      const state = JSON.parse(JSON.stringify(request.state))
      const questions: Parameters<ModelRuntime['classify']>[1]['questions'] = {}
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === 'noul') questions[id] = { type: 'bool', instructions: q.instructions, criteria: { true: 'Yes', false: 'No' } }
        if (q.type === 'score') questions[id] = { type: 'score', instructions: q.instructions, criteria: q.criteria as string[] }
        if (q.type === 'choice') questions[id] = { type: 'choice', instructions: q.instructions, criteria: Object.fromEntries(Object.entries(q.criteria!).map(([key, value]) => [key, value ?? key])) }
      }
      const result = await runtime.classify(model, { state: state && typeof state === 'object' && !Array.isArray(state) ? state : { input: state }, questions }, { signal: combined, timeoutMs: config.provider.timeoutMs, maxRetries: 0 })
      if (combined.aborted) throw new DecisionError(signal?.aborted ? 'cancelled' : 'timeout')
      if (result.stopReason === 'aborted') throw new DecisionError('cancelled')
      if (result.stopReason !== 'stop') throw new DecisionError('upstream_error')
      const answers: Result['answers'] = Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, answer.type === 'bool' ? { type: 'noul', noul: answer.probability } : { ...answer }]))
      validateAnswers(request, { model: result.model, answers }, true)
      return { actualModel: result.model, providerId: config.provider.id, modelConfigId: config.model.id, revision: config.revision, latencyMs: Date.now() - start, answers, usage: result.usage ?? null, confidenceSemantics: config.model.confidenceSemantics }
    } catch (error) {
      if (signal?.aborted) throw new DecisionError('cancelled')
      if (deadline.aborted) throw new DecisionError('timeout')
      if (error instanceof DecisionError) throw error
      throw new DecisionError('upstream_error')
    }
  }
}
export const nativeDecisionClient = new NativeDecisionClient()
