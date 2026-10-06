// Atomic, pi-compatible file writes for everything under ~/.pi/agent.
//
// pi takes a proper-lockfile lock on the FILE ITSELF
// (`lockfile.lockSync(path, { realpath: false })` in dist/core/auth-storage.js
// and dist/core/settings-manager.js) and writes with mode 0600. Locking anything
// else (e.g. the parent directory) does not exclude a running pi, so this module
// locks the same target and only ever swaps the file in via rename.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs"
import { dirname } from "node:path"

/** Pi 1.0.4 configuration permits line comments and trailing commas. */
export function parsePiJson(raw: string): unknown {
  const text = raw.replace(/^\uFEFF/, "").replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, m => m[0] === '"' ? m : "").replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ""))
  return JSON.parse(text)
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, "utf-8").replace(/^﻿/, "")
    const j = parsePiJson(raw)
    return j && typeof j === "object" ? (j as T) : null
  } catch { return null }
}

type Lockfile = typeof import("proper-lockfile")
let lockfileMod: Lockfile | null | undefined

async function lockfile(): Promise<Lockfile | null> {
  if (lockfileMod === undefined) {
    try { lockfileMod = await import("proper-lockfile") } catch { lockfileMod = null }
  }
  return lockfileMod
}

/**
 * Run `fn` while holding pi's file lock. proper-lockfile stats the target, so a
 * missing file is created first with `seed` (must be valid for the file's own
 * schema — e.g. `{"providers":{}}` for models.json, which pi validates strictly).
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T> | T, seed = "{}\n"): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) writeFileSync(path, seed, { encoding: "utf-8", mode: 0o600 })

  const lf = await lockfile()
  if (!lf) return fn() // locking unavailable: still write atomically below

  let release: (() => Promise<void>) | null = null
  try {
    release = await lf.lock(path, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 200 } })
  } catch {
    // Contended (a pi process is writing) — fall through and let the atomic
    // rename keep the file valid rather than failing the user's save outright.
  }
  try { return await fn() }
  finally { if (release) { try { await release() } catch {} } }
}

/** Write JSON atomically (tmp → rename) with pi's permissions. */
export function writeJsonAtomic(path: string, data: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.pi-ui-${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode })
    renameSync(tmp, path)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch {}
    throw e
  }
}

/** Read-modify-write one JSON file under pi's lock. */
export async function mutateJsonFile<T extends object>(
  path: string, fn: (cur: T) => T, seed: object = {},
): Promise<T> {
  const seedText = `${JSON.stringify(seed, null, 2)}\n`
  return withFileLock(path, () => {
    const cur = readJsonFile<T>(path)
    if (!cur) throw new Error("invalid_json_config")
    const next = fn(cur)
    writeJsonAtomic(path, next)
    return next
  }, seedText)
}
