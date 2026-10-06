import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import { NativeDecisionClient } from '../src/system-one/native.js'
import type { Resolved } from '../src/system-one/types.js'

test('native classifier uses Pi credentials, translates bool, retains score without invented probabilities and preserves usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-native-'))
  process.env.PI_UI_NATIVE_FIXTURE_KEY = 'fixture'
  try {
    const runtime = await ModelRuntime.create({ modelsPath: null, authPath: join(dir, 'auth.json'), modelsStorePath: join(dir, 'catalog.json'), refreshOnCreate: false, allowModelNetwork: false })
    let calls = 0
    runtime.registerNativeProvider(createProvider({ id: 'fixture', models: [{ type: 'classifier', id: 'decision', name: 'Fixture', api: 'fixture-classify', provider: 'fixture', baseUrl: 'https://example.invalid', contextWindow: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], auth: { apiKey: envApiKeyAuth('Fixture', ['PI_UI_NATIVE_FIXTURE_KEY']) }, classifiers: { 'fixture-classify': { async classify(model, context, options) {
      calls++; assert.equal(options?.apiKey, 'fixture'); assert.deepEqual(context.state, { input: 'synthetic' }); assert.equal(context.questions.flag.type, 'bool')
      return { api: model.api, provider: model.provider, model: model.id, answers: { pick: { type: 'choice', choice: 'a', probabilities: { a: .8, b: .2 }, confidence: .8 }, score: { type: 'score', score: 1.2, confidence: .6 }, flag: { type: 'bool', probability: .9 } }, usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 13, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() }
    } } } }))
    const client = new NativeDecisionClient(async () => runtime)
    const config: Resolved = { revision: 1, provider: { id: 'native', name: 'Pi', protocol: 'pi-native', endpoint: 'pi://fixture', piProviderId: 'fixture', auth: { mode: 'pi' }, timeoutMs: 1000 }, model: { id: 'model', providerId: 'native', name: 'Decision', remoteModel: 'decision', questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'vendor-defined' } }
    const r = await client.evaluate(config, { state: 'synthetic', questions: { pick: { type: 'choice', instructions: 'Pick', criteria: { a: 'A', b: 'B' } }, score: { type: 'score', instructions: 'Score', criteria: ['Low', 'Medium', 'High'] }, flag: { type: 'noul', instructions: 'Yes?' } } })
    assert.equal(calls, 1); assert.equal(r.answers.flag.noul, .9); assert.equal(r.answers.score.score, 1.2); assert.equal(r.answers.score.probabilities, undefined); assert.equal((r.usage as any).totalTokens, 13)
    assert.ok((await client.catalog()).some(m => m.provider === 'fixture' && m.id === 'decision'))
    const abort = new AbortController(); abort.abort()
    await assert.rejects(client.evaluate(config, { state: {}, questions: { flag: { type: 'noul', instructions: 'Yes?' } } }, abort.signal), { code: 'cancelled' })
    assert.equal(calls, 1)
  } finally { delete process.env.PI_UI_NATIVE_FIXTURE_KEY; rmSync(dir, { recursive: true, force: true }) }
})


test('UI can request the Pi native classifier catalog through the decision command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-native-catalog-'))
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = dir
  try {
    const { decisionCommand } = await import('../src/system-one/commands.js')
    const sent: any[] = []
    await decisionCommand({ send: event => sent.push(event) } as any, { t: 'decision_command', action: 'native_models', requestId: 'catalog' })
    assert.equal(sent.find(event => event.t === 'decision_result')?.ok, true)
    assert.ok(sent.find(event => event.t === 'decision_native_models')?.models.some((model: any) => model.provider === 'typesafe'))
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
