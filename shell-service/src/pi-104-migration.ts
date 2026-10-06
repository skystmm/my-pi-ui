import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAgentDir } from './paths.js'
import { parsePiJson, withFileLock, writeJsonAtomic } from './atomic-write.js'

const old = 'azure-openai-responses', next = 'azure'
const key = (value: string) => value === old ? next : value.startsWith(`${old}/`) ? `${next}/${value.slice(old.length + 1)}` : value
function renameKeys(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [id, item] of Object.entries(value)) {
    const target = key(id)
    if (target in out && JSON.stringify(out[target]) !== JSON.stringify(item)) throw new Error('pi_104_azure_conflict')
    out[target] = item
  }
  return out
}

/** Preserve originals before migrating the provider ID; API strings and JSONL history are unchanged. */
export async function migratePi104Azure(dir = getAgentDir()): Promise<{ migrated: string[]; backup?: string }> {
  const names = ['auth.json', 'models.json', 'settings.json'].filter(name => existsSync(join(dir, name)))
  const lock = async (index: number): Promise<{ migrated: string[]; backup?: string }> => {
    if (index < names.length) return withFileLock(join(dir, names[index]), () => lock(index + 1))
    const originals = new Map<string, string>(), updates = new Map<string, unknown>()
    for (const name of names) {
      const raw = readFileSync(join(dir, name), 'utf8'), config = parsePiJson(raw) as Record<string, any>
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid_json_config')
      originals.set(name, raw)
      let updated = { ...config }
      if (name === 'auth.json') updated = renameKeys(config)
      if (name === 'models.json' && config.providers) updated.providers = renameKeys(config.providers)
      if (name === 'settings.json') {
        if (typeof config.defaultProvider === 'string') updated.defaultProvider = key(config.defaultProvider)
        if (Array.isArray(config.enabledModels)) updated.enabledModels = config.enabledModels.map((s: unknown) => typeof s === 'string' ? key(s) : s)
        if (config.modelThinkingLevels) updated.modelThinkingLevels = renameKeys(config.modelThinkingLevels)
      }
      if (JSON.stringify(config) !== JSON.stringify(updated)) updates.set(name, updated)
    }
    if (!updates.size) return { migrated: [] }
    const backup = join(dir, 'pi-ui', 'migrations', `pi-1.0.4-${randomUUID()}`)
    mkdirSync(backup, { recursive: true, mode: 0o700 })
    for (const name of updates.keys()) writeFileSync(join(backup, name), originals.get(name)!, { mode: 0o600 })
    const written: string[] = []
    try {
      for (const [name, value] of updates) { writeJsonAtomic(join(dir, name), value); written.push(name) }
    } catch (error) {
      for (const name of written) { writeFileSync(join(dir, name), originals.get(name)!, { mode: 0o600 }); chmodSync(join(dir, name), 0o600) }
      throw error
    }
    return { migrated: written, backup }
  }
  return lock(0)
}
