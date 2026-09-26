import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import WebSocket from "ws"
import { createGuardedWebSocketServer, isWebSocketRequestAllowed } from "../src/ws-access.js"
import { listDir } from "../src/commands/files.js"
import { listSessionsForProject, resolveSessionFile, watchSessions } from "../src/session-bridge/jsonl-watcher.js"
import { scanProjects } from "../src/project-scanner.js"
import type { Ctx } from "../src/commands/context.js"

const temp = mkdtempSync(join(tmpdir(), "pi-ui-security-"))
const project = join(temp, "project")
const outside = join(temp, "outside")
const sessions = join(temp, "sessions")
const previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR

before(() => {
  mkdirSync(project)
  mkdirSync(outside)
  mkdirSync(sessions)
  mkdirSync(join(sessions, "--project--"))
  mkdirSync(join(sessions, "--file-link--"))
  mkdirSync(join(sessions, "----"))
  symlinkSync(outside, join(project, "escape"))
  symlinkSync(outside, join(sessions, "--linked--"))
  writeFileSync(join(outside, "secret.jsonl"), '{"type":"session","id":"secret","cwd":"/tmp"}\n')
  symlinkSync(join(outside, "secret.jsonl"), join(sessions, "--file-link--", "secret.jsonl"))
  writeFileSync(join(sessions, "--project--", "2026_valid.jsonl"), '{"type":"session","id":"valid","cwd":"/tmp"}\n')
  writeFileSync(join(sessions, "----", "2026_root.jsonl"), '{"type":"session","id":"root","cwd":"/"}\n')
  process.env.PI_CODING_AGENT_SESSION_DIR = sessions
})

after(() => {
  if (previousSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
  else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir
  rmSync(temp, { recursive: true, force: true })
})

test("WebSocket handshake accepts the local UI and rejects a foreign origin", async () => {
  const server = createServer()
  const wss = createGuardedWebSocketServer(server)
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const url = `ws://127.0.0.1:${address.port}/ws`
  const connect = (origin?: string) => new Promise<number>((resolve, reject) => {
    const client = new WebSocket(url, origin ? { origin } : undefined)
    client.on("open", () => { client.close(); resolve(101) })
    client.on("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0) })
    client.on("error", reject)
  })
  try {
    assert.equal(await connect("http://localhost:5173"), 101)
    assert.equal(await connect("https://untrusted.example"), 403)
    assert.equal(await connect(), 101) // local non-browser client
  } finally {
    await new Promise<void>(resolve => wss.close(() => resolve()))
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test("WebSocket policy rejects non-local peers and opaque origins", () => {
  assert.equal(isWebSocketRequestAllowed("http://localhost:5173", "192.168.1.20"), false)
  assert.equal(isWebSocketRequestAllowed("null", "127.0.0.1"), false)
  assert.equal(isWebSocketRequestAllowed("http://127.0.0.1:5173", "::ffff:127.0.0.1"), true)
})

test("session lookup rejects traversal and linked project directories", async () => {
  assert.ok(resolveSessionFile("--project--", "valid")?.endsWith("2026_valid.jsonl"))
  assert.ok(resolveSessionFile("----", "root")?.endsWith("2026_root.jsonl"))
  assert.equal((await listSessionsForProject("--project--")).length, 1)
  assert.equal(resolveSessionFile("../../outside", "secret"), null)
  assert.equal(resolveSessionFile("--project--", "../../outside/secret"), null)
  assert.equal(resolveSessionFile("--linked--", "secret"), null)
  assert.deepEqual(await listSessionsForProject("--linked--"), [])
  assert.equal(scanProjects().some(p => p.id === "--linked--"), false)
  assert.equal(scanProjects().some(p => p.id === "--file-link--"), false)
})

test("directory listing refuses a symlink outside the project", () => {
  const failures: string[] = []
  const sent: unknown[] = []
  const ctx = {
    fail: (code: string) => { failures.push(code) },
    send: (event: unknown) => { sent.push(event) },
  } as unknown as Ctx
  listDir(ctx, { t: "list_dir", cwd: project, path: "escape" })
  assert.deepEqual(sent, [])
  assert.deepEqual(failures, ["path_outside_project"])
  listDir(ctx, { t: "list_dir", cwd: project, path: "" })
  assert.equal(sent.length, 1)
  listDir(ctx, { t: "list_dir", cwd: project, path: "missing" })
  assert.equal(failures.at(-1), "path_not_found")
})

test("session watcher reports a JSONL update in a project directory", async () => {
  const file = join(sessions, "--project--", "watch-probe.jsonl")
  let observed = false
  const stop = watchSessions(projectId => { if (projectId === "--project--") observed = true })
  try {
    for (let i = 0; i < 25 && !observed; i++) {
      writeFileSync(file, `{"probe":${i}}\n`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(observed, true, "session watcher did not report the changed file")
  } finally {
    stop()
    unlinkSync(file)
  }
})
