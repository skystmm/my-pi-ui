import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import lockfile from 'proper-lockfile'
import { writeJsonAtomic } from '../atomic-write.js'
import { getAgentDir } from '../paths.js'
import { DecisionError, type Config, type Draft, type Resolved } from './types.js'
const empty = (): Config => ({ schemaVersion: 1, revision: 0, enabled: false, providers: [], models: [] })
function read<T>(path: string, fallback: T): T { if (!existsSync(path)) return fallback; try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { throw new DecisionError('invalid_config') } }
export class DecisionStore {
  readonly configPath: string
  private authPath: string
  private tests = new Map<string, { revision: number; at: string; ok: boolean; code?: string }>()
  private selections = new Map<string, string | null>()
  constructor(dir = join(getAgentDir(), 'pi-ui')) { this.configPath = join(dir, 'system-one.json'); this.authPath = join(dir, 'system-one-auth.json') }
  snapshot(): Config { const cfg = read(this.configPath, empty()); const auth = read<Record<string, string>>(this.authPath, {}); return { ...cfg, providers: cfg.providers.map(p => ({ ...p, credentialStatus: p.auth.mode === 'none' ? 'none' : (p.auth.mode === 'env' ? !!process.env[p.auth.envVar ?? '']?.trim() : !!auth[p.auth.credentialId ?? '']) ? 'configured' : 'missing' })), models: cfg.models.map(m => ({ ...m, lastTest: this.tests.get(m.id) })) } }
  recordTest(id: string, revision: number, ok: boolean, code?: string) { this.tests.set(id, { revision, at: new Date().toISOString(), ok, code }) }
  selection(cwd: string) { const cfg = this.snapshot(); return { scope: this.selections.has(cwd) ? 'project' : 'global', modelId: cfg.enabled ? (this.selections.has(cwd) ? this.selections.get(cwd) : cfg.defaultModelId) : null } }
  select(cwd: string, id: string | null | undefined) { if (id && !this.snapshot().models.some(m => m.id === id)) throw new DecisionError('unknown_model'); if (id === undefined) this.selections.delete(cwd); else this.selections.set(cwd, id) }
  resolve(cwd: string): Resolved {
    const cfg = this.snapshot(); if (!cfg.enabled) throw new DecisionError('disabled')
    const id = this.selection(cwd).modelId; if (id === null) throw new DecisionError('disabled')
    const model = cfg.models.find(m => m.id === id); if (!model) throw new DecisionError('not_configured')
    const provider = cfg.providers.find(p => p.id === model.providerId); if (!provider) throw new DecisionError('not_configured')
    let key: string | undefined
    if (provider.auth.mode === 'env') key = process.env[provider.auth.envVar ?? '']
    if (provider.auth.mode === 'secret') key = read<Record<string, string>>(this.authPath, {})[provider.auth.credentialId ?? '']
    if (provider.auth.mode !== 'none' && !key?.trim()) throw new DecisionError('missing_credential')
    return { provider, model, revision: cfg.revision, key }
  }
  resolveModel(id: string): Resolved { const fake = `test:${randomUUID()}`; this.selections.set(fake, id); try { return this.resolve(fake) } finally { this.selections.delete(fake) } }
  async save(draft: Draft): Promise<Config> {
    const dir = dirname(this.configPath); mkdirSync(dir, { recursive: true, mode: 0o700 })
    const lockTarget = join(dir, 'system-one.lock'); if (!existsSync(lockTarget)) writeFileSync(lockTarget, '', { mode: 0o600 })
    const release = await lockfile.lock(lockTarget, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } })
    try {
      const current = this.snapshot(); if (current.revision !== draft.revision) throw new DecisionError('config_conflict')
      if (!Array.isArray(draft.providers) || !Array.isArray(draft.models) || typeof draft.enabled !== 'boolean') throw new DecisionError('invalid_config')
      const auth = read<Record<string, string>>(this.authPath, {}); const nextAuth = { ...auth }; const ids = new Set<string>()
      const providers = draft.providers.map(p => {
        if (!p.id || ids.has(p.id) || !p.name?.trim()) throw new DecisionError('invalid_provider'); ids.add(p.id)
        const url = new URL(p.endpoint)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !['systemone-http', 'openrouter-decisions'].includes(p.protocol)) throw new DecisionError('invalid_endpoint')
        if (!Number.isInteger(p.timeoutMs) || p.timeoutMs < 1000 || p.timeoutMs > 120000) throw new DecisionError('invalid_timeout')
        if (!p.auth || !['none', 'env', 'secret'].includes(p.auth.mode)) throw new DecisionError('invalid_auth')
        if (p.auth.mode === 'env' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.auth.envVar ?? '')) throw new DecisionError('invalid_env')
        const previous = current.providers.find(x => x.id === p.id); const authRef = { ...p.auth }; delete authRef.credentialId
        if (p.auth.mode === 'secret') {
          if (p.apiKey?.trim()) { authRef.credentialId = randomUUID(); nextAuth[authRef.credentialId] = p.apiKey.trim() }
          else if (previous?.auth.mode === 'secret' && previous.auth.credentialId) authRef.credentialId = previous.auth.credentialId
          else throw new DecisionError('missing_credential')
        }
        return { id: p.id, name: p.name.trim(), protocol: p.protocol, endpoint: url.toString(), auth: authRef, timeoutMs: p.timeoutMs }
      })
      const modelIds = new Set<string>()
      const models = draft.models.map(m => {
        if (!m.id || modelIds.has(m.id) || !m.name?.trim() || !ids.has(m.providerId)) throw new DecisionError('invalid_model'); modelIds.add(m.id)
        if (!Array.isArray(m.questionTypes) || !m.questionTypes.length || m.questionTypes.some(t => !['choice', 'score', 'noul'].includes(t))) throw new DecisionError('invalid_capability')
        if (!['unknown', 'vendor-defined', 'normalized-entropy', 'max-probability'].includes(m.confidenceSemantics)) throw new DecisionError('invalid_capability')
        if (providers.find(p => p.id === m.providerId)?.protocol === 'openrouter-decisions' && !m.remoteModel?.trim()) throw new DecisionError('missing_model_id')
        for (const n of [m.maxQuestions, m.maxOptions]) if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 255)) throw new DecisionError('invalid_limit')
        return { id: m.id, name: m.name.trim(), providerId: m.providerId, remoteModel: m.remoteModel?.trim() || undefined, questionTypes: m.questionTypes, confidenceSemantics: m.confidenceSemantics, maxQuestions: m.maxQuestions, maxOptions: m.maxOptions }
      })
      if (draft.defaultModelId && !modelIds.has(draft.defaultModelId)) throw new DecisionError('selection_in_use')
      for (const id of this.selections.values()) if (id && !modelIds.has(id)) throw new DecisionError('selection_in_use')
      const next: Config = { schemaVersion: 1, revision: current.revision + 1, enabled: draft.enabled, providers, models, defaultModelId: draft.defaultModelId }
      writeJsonAtomic(this.authPath, nextAuth)
      try { writeJsonAtomic(this.configPath, next) } catch (e) { writeJsonAtomic(this.authPath, auth); throw e }
      const referenced = new Set(providers.map(p => p.auth.credentialId))
      try { writeJsonAtomic(this.authPath, Object.fromEntries(Object.entries(nextAuth).filter(([id]) => referenced.has(id)))) } catch { /* private orphan; config already committed */ }
      return next
    } finally { await release() }
  }
}
export const decisionStore = new DecisionStore()
