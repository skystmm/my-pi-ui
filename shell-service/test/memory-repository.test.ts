import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { MemoryConflictError, type MemoryRepository, type MemoryScope } from "../src/memory/repository.js"
import { openSqliteMemoryRepository } from "../src/memory/sqlite.js"

test("memory repository isolates scopes, searches Chinese text, and keeps revisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-memory-"))
  const path = join(root, "memory.sqlite")
  const app: MemoryScope = { kind: "app" }
  const project: MemoryScope = { kind: "project", projectPath: join(root, "project") }
  const session: MemoryScope = { kind: "session", projectPath: project.projectPath, sessionId: "session-1" }
  const otherProject: MemoryScope = { kind: "project", projectPath: join(root, "other") }
  let repo: MemoryRepository | undefined
  try {
    repo = openSqliteMemoryRepository(path)
    const global = await repo.create({ scope: app, content: "喜欢简洁回答", source: "manual" })
    const local = await repo.create({ scope: project, content: "项目使用 TypeScript" })
    const current = await repo.create({ scope: session, content: "会话决定采用 SQLite" })
    assert.equal(await repo.get(otherProject, local.id), null)
    assert.deepEqual(await repo.list(project), [local])
    assert.deepEqual((await repo.search({ scopes: [app, project], text: "简洁" })).map(m => m.id), [global.id])
    assert.deepEqual((await repo.search({ scopes: [session], text: "SQLite" })).map(m => m.id), [current.id])
    assert.deepEqual(await repo.search({ scopes: [], text: "SQLite" }), [])

    const edited = await repo.update(project, local.id, local.revision, "项目使用 TypeScript 和 Node")
    assert.equal(edited?.revision, 2)
    assert.deepEqual((await repo.search({ scopes: [project], text: "Node" })).map(m => m.id), [local.id])
    assert.deepEqual(await repo.search({ scopes: [project], text: "项目使用 TypeScript" }), [edited])
    await assert.rejects(repo.update(project, local.id, local.revision, "stale edit"), MemoryConflictError)
    assert.equal(await repo.delete(otherProject, local.id, edited!.revision), false)
    assert.deepEqual(await repo.history(otherProject, local.id), [])
    assert.equal(await repo.delete(project, local.id, edited!.revision), true)
    assert.equal(await repo.get(project, local.id), null)
    assert.deepEqual(await repo.search({ scopes: [project], text: "Node" }), [])
    assert.deepEqual((await repo.history(project, local.id)).map(r => r.action), ["create", "update", "delete"])
    await repo.close()
    repo = openSqliteMemoryRepository(path)
    assert.equal((await repo.get(app, global.id))?.content, global.content)
    assert.equal(await repo.get(project, local.id), null)
  } finally {
    await repo?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
