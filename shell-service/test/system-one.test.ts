import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DecisionStore } from '../src/system-one/store.js'
import { evaluateDecision } from '../src/system-one/client.js'

test('configuration preserves identity, hides credentials and rejects stale writes', async () => {
  const store = new DecisionStore(mkdtempSync(join(tmpdir(), 'decision-')))
  const saved = await store.save({ revision: 0, enabled: true, providers: [{ id: 'p', name: 'Local', protocol: 'systemone-http', endpoint: 'http://localhost:8000/v1/systemone', auth: { mode: 'secret' }, apiKey: 'private-key', timeoutMs: 1000 }], models: [{ id: 'm', providerId: 'p', name: 'Model', remoteModel: 'Kev/A:free', questionTypes: ['choice'], confidenceSemantics: 'unknown' }], defaultModelId: 'm' })
  assert.equal(saved.revision, 1)
  assert.equal(statSync(store.configPath).mode & 0o777, 0o600)
  assert.equal(statSync(join(store.configPath, '..', 'system-one-auth.json')).mode & 0o777, 0o600)
  assert.equal(store.snapshot().providers[0].credentialStatus, 'configured')
  store.recordTest('m', 1, true)
  assert.equal(store.snapshot().models[0].lastTest?.revision, 1)
  assert.ok(!JSON.stringify(saved).includes('private-key'))
  assert.equal(store.resolve('/project').key, 'private-key')
  await assert.rejects(store.save({ ...saved, revision: 0 }), /config_conflict/)
  await store.save({ ...saved, providers: saved.providers.map(p => ({ ...p, name: 'Renamed' })) })
  assert.equal(store.resolve('/project').model.id, 'm')
  store.select('/project', null)
  assert.throws(() => store.resolve('/project'), /disabled/)
  assert.ok(!readFileSync(store.configPath, 'utf8').includes('private-key'))
})

test('public client validates responses and does not send unsupported questions', async () => {
  const question = { type: 'choice' as const, instructions: 'Route?', criteria: { review: 'Review', build: 'Build' } }
  const config = { provider: { id: 'p', name: 'Local', protocol: 'systemone-http' as const, endpoint: 'http://localhost/v1/systemone', auth: { mode: 'none' as const }, timeoutMs: 1000 }, model: { id: 'm', providerId: 'p', name: 'M', questionTypes: ['choice'] as ('choice')[], confidenceSemantics: 'unknown' as const }, revision: 1 }
  const response = { model: 'actual', answers: { task: { type: 'choice', choice: 'review', probabilities: { review: 0.8, build: 0.2 }, confidence: 0.6 } }, usage: { input_tokens: 5 } }
  const result = await evaluateDecision(config, { state: 'Check PR', questions: { task: question } }, undefined, async () => new Response(JSON.stringify(response)))
  assert.equal(result.actualModel, 'actual')
  assert.equal(result.answers.task.choice, 'review')
  await assert.rejects(evaluateDecision(config, { state: '', questions: { task: question } }, undefined, async () => new Response(JSON.stringify({ ...response, answers: { task: { type: 'choice', choice: 'unknown' } } }))), /invalid_response/)
  await assert.rejects(evaluateDecision(config, { state: '', questions: { urgent: { type: 'noul', instructions: '?' } } }, undefined, async () => { throw new Error('must not call') }), /unsupported_capability/)
})

test('three question types and error statuses preserve native values without fallback', async () => {
  const store = new DecisionStore(mkdtempSync(join(tmpdir(), 'decision-')))
  await store.save({ revision: 0, enabled: true, providers: [{ id: 'p', name: 'OR', protocol: 'openrouter-decisions', endpoint: 'https://openrouter.ai/api/alpha/decisions', auth: { mode: 'none' }, timeoutMs: 1000 }], models: [{ id: 'm', providerId: 'p', name: 'M', remoteModel: '~typesafe/jev-latest', questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'vendor-defined' }], defaultModelId: 'm' })
  const config = store.resolve('')
  const request = { state: { text: 'Review code' }, questions: { task: { type: 'choice' as const, instructions: '?', criteria: { review: '', build: '' } }, level: { type: 'score' as const, instructions: '?', criteria: ['low', 'high'] }, yes: { type: 'noul' as const, instructions: '?' } } }
  const response = { model: 'pinned-version', answers: { task: { type: 'choice', choice: 'review', confidence: 0.6, probabilities: { review: 0.8, build: 0.2 } }, level: { type: 'score', score: 0.75, confidence: 0.5, probabilities: { '0': 0.25, '1': 0.75 } }, yes: { type: 'noul', noul: 0.9 } }, usage: { cost: 0.01 } }
  const result = await evaluateDecision(config, request, undefined, async (_url, options) => { assert.equal(JSON.parse(String(options?.body)).model, '~typesafe/jev-latest'); return new Response(JSON.stringify(response)) })
  assert.equal(result.answers.level.score, 0.75)
  assert.equal(result.answers.yes.confidence, undefined)
  for (const [status, error] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [500, 'upstream_error']] as const) {
    let calls = 0
    await assert.rejects(evaluateDecision(config, request, undefined, async () => { calls++; return new Response('SECRET', { status }) }), new RegExp(error))
    assert.equal(calls, 1)
  }
  for (const answers of [{ ...response.answers, yes: { type: 'noul', noul: 2 } }, { ...response.answers, level: { ...response.answers.level, score: 2 } }]) await assert.rejects(evaluateDecision(config, request, undefined, async () => new Response(JSON.stringify({ ...response, answers }))), /invalid_response/)
})

test('broker pins in-flight model, uses new selection next time, rejects forged identity and revoked grants', async () => {
  const { createServer } = await import('node:http')
  const { DecisionBroker } = await import('../src/system-one/broker.js')
  let release!: () => void
  let arrived!: () => void
  const arrival = new Promise<void>(r => { arrived = r })
  const gate = new Promise<void>(r => { release = r })
  let requests = 0
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const data = JSON.parse(raw)
    if (data.model === 'old') { requests++; arrived(); await gate }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model: data.model, answers: { yes: { type: 'noul', noul: 0.8 } } }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address() as { port: number }
  const store = new DecisionStore(mkdtempSync(join(tmpdir(), 'decision-')))
  await store.save({ revision: 0, enabled: true, providers: [{ id: 'p', name: 'Fixture', protocol: 'systemone-http', endpoint: `http://127.0.0.1:${address.port}/v1/systemone`, auth: { mode: 'none' }, timeoutMs: 5000 }], models: ['old', 'new'].map(id => ({ id, providerId: 'p', name: id, remoteModel: id, questionTypes: ['noul'], confidenceSemantics: 'unknown' })), defaultModelId: 'old' })
  const broker = new DecisionBroker(store); const grant = await broker.grant('/A')
  const headers = { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }; const body = JSON.stringify({ state: 'review', questions: { yes: { type: 'noul', instructions: '?' } } })
  try {
    const first = fetch(grant.url, { method: 'POST', headers, body }); await arrival
    const second = fetch(grant.url, { method: 'POST', headers, body })
    // The fixture signals each request so both slots are occupied before the third.
    while (requests < 2) await new Promise(r => setTimeout(r, 5))
    assert.equal((await (await fetch(grant.url, { method: 'POST', headers, body })).json()).code, 'busy')
    store.select('/A', 'new'); release()
    assert.equal((await (await second).json()).actualModel, 'old')
    assert.equal((await (await first).json()).actualModel, 'old')
    assert.equal((await (await fetch(grant.url, { method: 'POST', headers, body })).json()).actualModel, 'new')
    assert.equal((await fetch(grant.url, { method: 'POST', body })).status, 403)
    assert.equal((await fetch(grant.url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body })).status, 403)
    const forged = await fetch(grant.url, { method: 'POST', headers, body: JSON.stringify({ ...JSON.parse(body), cwd: '/B', model: 'old' }) })
    assert.equal((await forged.json()).code, 'invalid_request')
    const { default: extension } = await import('../src/system-one/pi-extension.js')
    let tool: { execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{ details: unknown }> } | undefined
    extension({ registerTool: t => { tool = t } })
    const oldUrl = process.env.PI_UI_DECISION_URL; const oldToken = process.env.PI_UI_DECISION_TOKEN
    process.env.PI_UI_DECISION_URL = grant.url; process.env.PI_UI_DECISION_TOKEN = grant.token
    try {
      const result = await tool!.execute('call', JSON.parse(body))
      assert.equal((result.details as { actualModel: string }).actualModel, 'new')
    } finally {
      if (oldUrl === undefined) delete process.env.PI_UI_DECISION_URL; else process.env.PI_UI_DECISION_URL = oldUrl
      if (oldToken === undefined) delete process.env.PI_UI_DECISION_TOKEN; else process.env.PI_UI_DECISION_TOKEN = oldToken
    }
    grant.revoke(); assert.equal((await fetch(grant.url, { method: 'POST', headers, body })).status, 403)
  } finally { release(); await broker.close(); await new Promise<void>(r => server.close(() => r())) }
})

test('cancel and deadline terminate fetch without leaking underlying errors', async () => {
  const store = new DecisionStore(mkdtempSync(join(tmpdir(), 'decision-')))
  await store.save({ revision: 0, enabled: true, providers: [{ id: 'p', name: 'Fixture', protocol: 'systemone-http', endpoint: 'http://localhost:9999/v1/systemone', auth: { mode: 'none' }, timeoutMs: 1000 }], models: [{ id: 'm', providerId: 'p', name: 'M', questionTypes: ['noul'], confidenceSemantics: 'unknown' }], defaultModelId: 'm' })
  const request = { state: '', questions: { yes: { type: 'noul' as const, instructions: '?' } } }
  const stalled: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => { const signal = options?.signal; if (signal?.aborted) reject(new Error('SECRET')); else signal?.addEventListener('abort', () => reject(new Error('SECRET')), { once: true }) })
  const ctrl = new AbortController(); const call = evaluateDecision(store.resolve(''), request, ctrl.signal, stalled); ctrl.abort(); await assert.rejects(call, /cancelled/)
  // Keep the event loop alive while AbortSignal.timeout's unref'ed timer runs.
  const keepAlive = setInterval(() => {}, 100)
  try { await assert.rejects(evaluateDecision(store.resolve(''), request, undefined, stalled), /timeout/) } finally { clearInterval(keepAlive) }
})
