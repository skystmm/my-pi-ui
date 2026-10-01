import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import memoryExtension from "../src/memory/pi-extension.js"
import { openSqliteMemoryRepository } from "../src/memory/sqlite.js"
import { updateMemorySettings } from "../src/memory/settings.js"

test("Pi extension injects selected memory once per context call without changing the user prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-extension-"))
  const prior = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root
  const projectPath = join(root, "project")
  const repo = openSqliteMemoryRepository()
  try {
    const saved = await repo.create({ scope: { kind: "project", projectPath }, content: "此项目使用 SQLite" })
    const handlers = new Map<string, (event: any, ctx: any) => any>()
    const status: string[] = []
    memoryExtension({
      on(name, handler) { handlers.set(name, handler) },
      registerCommand() {},
    })
    const ctx = {
      cwd: projectPath,
      mode: "rpc",
      sessionManager: { getSessionId: () => "session-a" },
      ui: { setStatus: (_key: string, text: string) => status.push(text), notify() {}, editor: async () => undefined },
    }
    const prompt = "SQLite 怎么接入？"
    await handlers.get("before_agent_start")!({ prompt }, ctx)
    assert.equal(prompt, "SQLite 怎么接入？")
    assert.equal(JSON.parse(status.at(-1)!).memories[0].id, saved.id)
    const original = { role: "user", content: prompt, timestamp: 1 }
    const first = handlers.get("context")!({ messages: [original] }, ctx)
    const second = handlers.get("context")!({ messages: [original] }, ctx)
    assert.equal(first.messages.length, 2)
    assert.equal(second.messages.length, 2)
    assert.equal(first.messages[0].customType, "pi-ui-memory-context")
    assert.equal(first.messages[0].display, false)
    assert.deepEqual(first.messages[1], original)
    await handlers.get("agent_settled")!({}, ctx)
    assert.equal(handlers.get("context")!({ messages: [original] }, ctx), undefined)
    await updateMemorySettings({ recallEnabled: false })
    await handlers.get("before_agent_start")!({ prompt }, ctx)
    assert.equal(handlers.get("context")!({ messages: [original] }, ctx), undefined)
    await handlers.get("session_shutdown")!({}, ctx)
  } finally {
    await repo.close()
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = prior
    rmSync(root, { recursive: true, force: true })
  }
})
