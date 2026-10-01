import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { openSqliteMemoryRepository } from "../src/memory/sqlite.js"
import { selectMemories } from "../src/memory/selector.js"

test("selection respects scope, keeps app preferences and enforces a size budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-memory-select-"))
  const repo = openSqliteMemoryRepository(join(root, "memory.sqlite"))
  const project = { kind: "project" as const, projectPath: join(root, "project") }
  const other = { kind: "project" as const, projectPath: join(root, "other") }
  const session = { kind: "session" as const, projectPath: project.projectPath, sessionId: "one" }
  try {
    const preference = await repo.create({ scope: { kind: "app" }, content: "回答保持简洁" })
    const relevant = await repo.create({ scope: project, content: "本项目使用 SQLite 存储记忆" })
    await repo.create({ scope: other, content: "SQLite 来自其他项目" })
    await repo.create({ scope: { ...session, sessionId: "two" }, content: "SQLite 只属于其他会话" })
    const local = await repo.create({ scope: session, content: "当前会话先完成 SQLite 集成" })
    const selected = await selectMemories(repo, { projectPath: project.projectPath, sessionId: "one", prompt: "SQLite 怎么接入？" })
    assert.deepEqual(new Set(selected.map(m => m.id)), new Set([preference.id, relevant.id, local.id]))
    for (let i = 0; i < 101; i++) await repo.create({ scope: project, content: `无关条目 ${i}` })
    assert.ok((await selectMemories(repo, { projectPath: project.projectPath, sessionId: "one", prompt: "SQLite 怎么接入？" })).some(m => m.id === relevant.id))
    const narrow = await selectMemories(repo, { projectPath: project.projectPath, sessionId: "one", prompt: "SQLite", maxChars: 10 })
    assert.ok(narrow.every(m => m.content.length <= 10))
    assert.ok(narrow.length <= 3)
  } finally {
    await repo.close()
    rmSync(root, { recursive: true, force: true })
  }
})
