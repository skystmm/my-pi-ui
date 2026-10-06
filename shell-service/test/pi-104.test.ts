import test from 'node:test'
import assert from 'node:assert/strict'
import { validateModelsConfig } from '../src/models-config.js'
import { entryLabel, parseEntryLine } from '../src/session-entry-schema.js'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migratePi104Azure } from '../src/pi-104-migration.js'
import { parsePiJson } from '../src/atomic-write.js'
import { listProviders } from '../src/providers.js'

test('Pi 1.0.4 Azure API configuration is writable and invalid custom models are rejected', () => {
  assert.equal(validateModelsConfig({ providers: { azure: { baseUrl: 'https://example.invalid/openai/v1', api: 'azure-openai-responses' as any, models: [{ id: 'gpt-4.1' }] } } }), null)
  assert.equal(validateModelsConfig({ providers: { fixture: { models: [{ id: 'custom-model' }] } } }), 'missing_base_url_or_api')
  assert.equal(validateModelsConfig({ providers: { fixture: { baseUrl: 'http://localhost:1', api: '' as any, models: [{ id: 'model' }] } } }), 'invalid_api')
  assert.equal(validateModelsConfig({ providers: { openai: { models: [{ id: 'gpt-4.1', name: 'My name' }] } } }), null)
})

test('OAuth and environment-only Pi models have provider rows without exposing credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi104-providers-')), prev = process.env.PI_CODING_AGENT_DIR
  try {
    process.env.PI_CODING_AGENT_DIR = dir
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'PRIVATE_ACCESS', refresh: 'PRIVATE_REFRESH' } }))
    const providers = listProviders([{ provider: 'openai-codex', id: 'fixture' }, { provider: 'deepseek', id: 'env-model' }])
    assert.equal(providers.find(p => p.id === 'openai-codex')?.auth, 'oauth')
    assert.equal(providers.find(p => p.id === 'deepseek')?.status, 'connected')
    assert.ok(!JSON.stringify(providers).includes('PRIVATE_'))
  } finally { if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prev; rmSync(dir, { recursive: true, force: true }) }
})

test('Azure provider migration backs up credentials, preserves API IDs and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi104-migration-'))
  try {
    const auth = JSON.stringify({ 'azure-openai-responses': { type: 'api_key', key: 'fixture' }, openai: { type: 'api_key', key: 'another' } })
    writeFileSync(join(dir, 'auth.json'), auth)
    writeFileSync(join(dir, 'models.json'), JSON.stringify({ providers: { 'azure-openai-responses': { api: 'azure-openai-responses' } } }))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultProvider: 'azure-openai-responses', enabledModels: ['azure-openai-responses/*', 'openai/*'], modelThinkingLevels: { 'azure-openai-responses/gpt-4.1': 'off' }, unrelated: true }))
    const migrated = await migratePi104Azure(dir)
    assert.equal(migrated.migrated.length, 3)
    assert.equal(readFileSync(join(migrated.backup!, 'auth.json'), 'utf8'), auth)
    assert.equal(statSync(join(migrated.backup!, 'auth.json')).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8')).providers.azure.api, 'azure-openai-responses')
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    assert.equal(settings.defaultProvider, 'azure'); assert.deepEqual(settings.enabledModels, ['azure/*', 'openai/*']); assert.equal(settings.unrelated, true)
    assert.deepEqual((await migratePi104Azure(dir)).migrated, [])
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ azure: { key: 'new' }, 'azure-openai-responses': { key: 'old' } }))
    const conflicting = readFileSync(join(dir, 'auth.json'), 'utf8')
    await assert.rejects(migratePi104Azure(dir), /pi_104_azure_conflict/)
    assert.equal(readFileSync(join(dir, 'auth.json'), 'utf8'), conflicting)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Pi commented configuration parses without altering URL strings', () => {
  assert.deepEqual(parsePiJson('\uFEFF{ // config\n"url":"https://example.invalid/a//b", "models": ["m",],}'), { url: 'https://example.invalid/a//b', models: ['m'] })
})

test('Pi 1.0.4 context edits and independent usage remain visible without rewriting history', () => {
  const base = { id: 'meta', parentId: 'original', timestamp: '2026-10-06T00:00:00Z' }
  const omitted = parseEntryLine(JSON.stringify({ ...base, type: 'context_edit', targetId: 'original', replacement: null }))!
  assert.equal(entryLabel(omitted as any), 'context · omit original')
  const replaced = { ...base, type: 'context_edit', targetId: 'original', replacement: { content: 'shortened' } }
  assert.equal(entryLabel(replaced as any), 'context · replace original')
  const usage = { ...base, type: 'usage', kind: 'cache_warm', provider: 'fixture', model: 'chat', usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 } }
  assert.equal(entryLabel(usage as any), 'usage · cache_warm · fixture/chat')
})
