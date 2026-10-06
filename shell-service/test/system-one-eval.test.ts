import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvalService } from '../src/system-one/eval/service.js'
import { smokeSuite } from '../src/system-one/eval/suites.js'
import { scoreRows } from '../src/system-one/eval/metrics.js'
import type { Resolved, Result } from '../src/system-one/types.js'
const config: Resolved = { revision: 3, provider: { id: 'p', name: 'Local', protocol: 'systemone-http', endpoint: 'http://localhost/test?secret=never', auth: { mode: 'none' }, timeoutMs: 1000 }, model: { id: 'm', providerId: 'p', name: 'Model', questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'unknown' }, key: 'PRIVATE' }
const perfect = async (_: Resolved, request: any): Promise<Result> => {
  const item = smokeSuite.cases.find(c => c.request.state === request.state)!
  const expected = item.expected; const q = request.questions.decision
  const answer = expected.type === 'choice' ? { type: 'choice', choice: expected.label, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === expected.label ? 1 : 0])), confidence: 0 } : expected.type === 'noul' ? { type: 'noul', noul: expected.label ? 1 : 0, confidence: 0 } : { type: 'score', score: expected.label, probabilities: Object.fromEntries(q.criteria.map((_: unknown, i: number) => [i, i === expected.label ? 1 : 0])), confidence: 0 }
  return { actualModel: 'fixture', modelConfigId: 'm', providerId: 'p', revision: 3, latencyMs: 1, answers: { decision: answer }, usage: null, confidenceSemantics: 'unknown' }
}
test('fixed labels produce perfect per-type metrics; report never persists credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's1-eval-'))
  const service = new EvalService({ dir, resolve: () => structuredClone(config), evaluate: perfect })
  const started = service.start({ suiteId: 'smoke-v1', modelIds: ['m'], repeats: 1 }, 'test')
  const report = await service.settled(started.id)
  assert.equal(report.run.status, 'completed')
  assert.equal(report.run.completed, 6)
  const choice = report.metrics.find(x => x.type === 'choice' && x.group === 'all')!
  assert.equal(choice.accuracy, 1); assert.equal(choice.brier, 0); assert.equal(choice.ece, 0)
  assert.equal(report.metrics.find(x => x.type === 'noul' && x.group === 'all')!.f1, 1)
  assert.equal(report.metrics.find(x => x.type === 'score' && x.group === 'all')!.mae, 0)
  const manifest = readFileSync(join(dir, started.id, 'manifest.json'), 'utf8')
  assert.ok(!manifest.includes('PRIVATE')); assert.ok(!manifest.includes('secret=never'))
  assert.equal(statSync(join(dir, started.id, 'report.json')).mode & 0o777, 0o600)
  assert.equal(service.compare(started.id, started.id).compatible, true)
  assert.equal(service.get(started.id).promotionEligible, false) // smoke is not a quality benchmark
})
test('attempted denominator includes failures and unsupported cases remain separate', () => {
  const rows: any[] = [
    { modelId: 'm', caseId: 'choice-en', repeat: 0, status: 'ok', latencyMs: 10, result: { answers: { decision: { choice: 'review', probabilities: { review: .8, build: .2 } } } } },
    { modelId: 'm', caseId: 'choice-zh', repeat: 0, status: 'error', latencyMs: 30, code: 'timeout' },
    { modelId: 'm', caseId: 'score-en', repeat: 0, status: 'unsupported' },
  ]
  const score = scoreRows(smokeSuite, rows).find(x => x.type === 'choice' && x.group === 'all')!
  assert.equal(score.valid, 1); assert.equal(score.attempted, 2); assert.equal(score.accuracy, 1); assert.equal(score.attemptedAccuracy, .5)
  assert.ok(Math.abs(score.brier! - .08) < 1e-10); assert.ok(Math.abs(score.ece! - .2) < 1e-10)
})
test('run limits reject before any calls; cancellation persists and restart marks interrupted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's1-eval-'))
  const service = new EvalService({ dir, resolve: () => config, evaluate: async (_c, _r, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
  assert.throws(() => service.start({ suiteId: 'smoke-v1', modelIds: ['m'], repeats: 40 }, 'test'), /invalid_run/)
  assert.throws(() => service.start({ suiteId: 'smoke-v1', modelIds: ['m', 'm'] }, 'test'), /invalid_run/)
  const started = service.start({ suiteId: 'smoke-v1', modelIds: ['m'] }, 'test')
  assert.throws(() => service.start({ suiteId: 'smoke-v1', modelIds: ['m'] }, 'test'), /eval_busy/)
  service.cancel(started.id)
  assert.equal((await service.settled(started.id)).run.status, 'cancelled')
  assert.throws(() => service.get('../bad'), /invalid_run_id/)
})

test('answers use the actual System One schema, failure codes and frozen configuration', async () => {
  const { validateAnswers } = await import('../src/system-one/client.js')
  const { DecisionError } = await import('../src/system-one/types.js')
  const mutable = structuredClone(config), calls: Resolved[] = []
  const service = new EvalService({ dir: mkdtempSync(join(tmpdir(), 's1-eval-')), resolve: () => mutable, evaluate: async (cfg, request) => {
    calls.push(cfg); mutable.model.remoteModel = 'changed'; mutable.revision = 10
    if (calls.length === 2) throw new DecisionError('invalid_response')
    const result = await perfect(cfg, request)
    validateAnswers(request, { model: result.actualModel, answers: result.answers })
    return result
  } })
  const run = service.start({ suiteId: 'smoke-v1', modelIds: ['m'] }, 'test')
  const report = await service.settled(run.id)
  assert.equal(calls.length, 6); assert.equal(calls[5].revision, 3); assert.equal(calls[5].model.remoteModel, undefined)
  assert.equal(report.run.errors, 1); assert.equal(report.errors.invalid_response, 1)
  const metric = report.metrics.find(m => m.type === 'noul' && m.group === 'all')!
  assert.equal(metric.accuracy, 1); assert.equal(metric.brier, 0)
})
test('unsupported capabilities make no network calls; surviving hosts are not interrupted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's1-eval-'))
  let calls = 0, release!: () => void, arrived!: () => void
  const arrival = new Promise<void>(r => { arrived = r }), gate = new Promise<void>(r => { release = r })
  const service = new EvalService({ dir, resolve: () => ({ ...config, model: { ...config.model, questionTypes: ['noul'] } }), evaluate: async (cfg, req) => { calls++; arrived(); await gate; return perfect(cfg, req) } })
  const run = service.start({ suiteId: 'smoke-v1', modelIds: ['m'] }, 'test'); await arrival
  const secondHost = new EvalService({ dir })
  assert.equal(secondHost.get(run.id).status, 'running')
  release(); const report = await service.settled(run.id)
  assert.equal(calls, 2); assert.equal(report.run.skipped, 4)
  const failedComparison = service.start({ suiteId: 'smoke-v1', modelIds: ['m'], repeats: 2 }, 'test')
  await service.settled(failedComparison.id)
  assert.equal(service.compare(run.id, failedComparison.id).compatible, false)
  const { writeFileSync } = await import('node:fs')
  const persisted = { ...report.run, status: 'running' }
  writeFileSync(join(dir, run.id, 'manifest.json'), JSON.stringify(persisted))
  writeFileSync(join(dir, run.id, 'lease.json'), JSON.stringify({ pid: 2147483647 }))
  assert.equal(new EvalService({ dir }).get(run.id).status, 'interrupted')
})
test('evaluation capability is separate, validates input and revocation cancels an owned job', async () => {
  const { EvalBroker } = await import('../src/system-one/eval/broker.js')
  const service = new EvalService({ dir: mkdtempSync(join(tmpdir(), 's1-eval-')), resolve: () => config, evaluate: perfect })
  const broker = new EvalBroker(service), grant = await broker.grant()
  try {
    const headers = { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }
    assert.equal((await fetch(grant.url, { method: 'POST', body: '{}' })).status, 403)
    assert.equal((await fetch(grant.url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403)
    const response = await fetch(grant.url, { method: 'POST', headers, body: JSON.stringify({ action: 'run', spec: { suiteId: 'smoke-v1', modelIds: ['m'] } }) })
    const run = await response.json() as any; assert.equal(response.status, 200)
    grant.revoke(); const report = await service.settled(run.id)
    assert.ok(['completed', 'cancelled'].includes(report.run.status))
    assert.equal((await fetch(grant.url, { method: 'POST', headers, body: '{"action":"suites"}' })).status, 403)
  } finally { await broker.close() }
})
test('slash command parses strictly and registers without making LLM calls', async () => {
  const { parseEvalCommand } = await import('../src/system-one/eval/command-parser.js')
  assert.deepEqual(parseEvalCommand('run --models one,two --repeats 2'), { action: 'run', spec: { suiteId: 'smoke-v1', modelIds: ['one', 'two'], repeats: 2 } })
  assert.throws(() => parseEvalCommand('run --models one --endpoint evil'), /invalid_arguments/)
  assert.throws(() => parseEvalCommand('report'), /run_id_required/)
  const { default: plugin } = await import('../src/system-one/eval/pi-extension.js')
  let registered = ''
  plugin({ registerCommand(name) { registered = name }, appendEntry() {}, on() {} })
  assert.equal(registered, 's1-eval')
})

test('cancelling an in-flight HTTP attempt records it and stops further calls', async () => {
  let arrived!: () => void, calls = 0
  const arrival = new Promise<void>(r => { arrived = r })
  const service = new EvalService({ dir: mkdtempSync(join(tmpdir(), 's1-eval-')), resolve: () => config, evaluate: async (_cfg, _req, signal) => { calls++; arrived(); return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('private raw error')), { once: true })) } })
  const run = service.start({ suiteId: 'smoke-v1', modelIds: ['m'], repeats: 2 }, 'test')
  await arrival; service.cancel(run.id)
  const report = await service.settled(run.id)
  assert.equal(report.run.status, 'cancelled'); assert.equal(calls, 1); assert.equal(report.run.completed, 1); assert.equal(report.errors.cancelled, 1)
  assert.equal(report.metrics.find(m => m.type === 'choice' && m.group === 'all')!.attempted, 1)
  assert.ok(!JSON.stringify(report).includes('private raw error'))
})

test('job deadline aborts in-flight evaluation and does not retry', async () => {
  let calls = 0
  const service = new EvalService({ dir: mkdtempSync(join(tmpdir(), 's1-eval-')), resolve: () => config, deadlineMs: 20, evaluate: async (_cfg, _req, signal) => { calls++; return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('deadline')), { once: true })) } })
  const run = service.start({ suiteId: 'smoke-v1', modelIds: ['m'], repeats: 2 }, 'test')
  const report = await service.settled(run.id)
  assert.equal(report.run.status, 'deadline'); assert.equal(calls, 1); assert.equal(report.errors.deadline, 1)
})

test('a journal failure fails the job without crashing the host or returning quality scores', async () => {
  const { mkdirSync, rmSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 's1-eval-'))
  let release!: () => void, arrived!: () => void
  const arrival = new Promise<void>(r => { arrived = r }), gate = new Promise<void>(r => { release = r })
  const service = new EvalService({ dir, resolve: () => config, evaluate: async (cfg, req) => { arrived(); await gate; return perfect(cfg, req) } })
  const run = service.start({ suiteId: 'smoke-v1', modelIds: ['m'] }, 'test'); await arrival
  const journal = join(dir, run.id, 'events.jsonl'); rmSync(journal); mkdirSync(journal)
  release(); const report = await service.settled(run.id)
  assert.equal(report.run.status, 'failed'); assert.equal(report.errors.storage_error, 1); assert.deepEqual(report.metrics, [])
  assert.equal(service.get(run.id).status, 'failed'); assert.equal(service.report(run.id).errors.storage_error, 1)
})
