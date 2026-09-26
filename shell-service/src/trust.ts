import { existsSync } from "node:fs"
import { getTrustPath } from "./paths.js"
import { readJsonFile, mutateJsonFile } from "./atomic-write.js"

type TrustData = Record<string, boolean | null>

/**
 * pi's project trust store (~/.pi/agent/trust.json), same value shape as
 * dist/core/trust-manager.js: `{ "<cwd>": true | false | null }`, written under
 * pi's own file lock.
 */
export function isTrusted(cwd: string): boolean | null {
  const t = readJsonFile<TrustData>(getTrustPath()) ?? {}
  return cwd in t ? t[cwd] : null
}

export function getTrustState(cwd: string): "trusted" | "untrusted" | "unknown" {
  const v = isTrusted(cwd)
  if (v === true) return "trusted"
  if (v === false) return "untrusted"
  return "unknown"
}

export async function setTrusted(cwd: string, trusted: boolean): Promise<void> {
  await mutateJsonFile<TrustData>(getTrustPath(), (cur) => ({ ...cur, [cwd]: trusted }))
}

export function trustStoreExists(): boolean { return existsSync(getTrustPath()) }
