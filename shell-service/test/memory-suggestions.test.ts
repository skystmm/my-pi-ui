import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { listSuggestions, observePreference, rememberPreferenceTurn, resolveSuggestion, settlePreferenceTurn } from "../src/memory/suggestions.js"
import { updateMemorySettings } from "../src/memory/settings.js"

test("implicit preference detection only proposes confirmed-scope candidates", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-suggestions-"))
  const prior = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root
  try {
    assert.equal(await observePreference("这次回答简短一点", "/project-a", "s1"), null)
    assert.equal(await observePreference("我喜欢简洁回答", "/project-a", "s1"), null)
    const project = await observePreference("我喜欢简洁回答", "/project-a", "s2")
    assert.equal(project?.scope.kind, "project")
    assert.equal((await listSuggestions("/project-a")).length, 1)
    const global = await observePreference("我喜欢简洁回答", "/project-b", "s3")
    assert.equal(global?.scope.kind, "app")
    await resolveSuggestion(global!.id, "rejected")
    assert.equal(await observePreference("我喜欢简洁回答", "/project-c", "s4"), null)
    const explicit = await observePreference("以后所有项目都用中文回答", "/project-a", "s5")
    assert.equal(explicit?.scope.kind, "app")
    await updateMemorySettings({ suggestEnabled: false })
    rememberPreferenceTurn("/project-a", "s6", "以后先给结论")
    assert.equal(await settlePreferenceTurn("/project-a"), null)
  } finally {
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = prior
    rmSync(root, { recursive: true, force: true })
  }
})
