import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { readFilePreview, searchFiles } from "../src/commands/files.js"
import { pidForCwd, registerPidCwd } from "../src/project-scanner.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("text preview and name search stay inside the project", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-files-"))
  const project = join(root, "project")
  const outside = join(root, "outside")
  const events: ShellEvent[] = []
  const errors: string[] = []
  const previousSessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR
  const ctx = {
    send: (event: ShellEvent) => events.push(event),
    fail: (code: string) => errors.push(code),
  } as unknown as Ctx
  try {
    mkdirSync(join(project, "src"), { recursive: true })
    const sessions = join(root, "sessions")
    mkdirSync(join(sessions, pidForCwd(project)), { recursive: true })
    process.env.PI_CODING_AGENT_SESSION_DIR = sessions
    registerPidCwd(pidForCwd(project), project)
    mkdirSync(outside)
    writeFileSync(join(project, "src", "example.ts"), "export const value = 1\n")
    writeFileSync(join(project, "src", "binary.bin"), Buffer.from([0, 1, 2]))
    writeFileSync(join(outside, "secret.ts"), "secret")
    symlinkSync(outside, join(project, "escape"))

    readFilePreview(ctx, { t: "read_file", cwd: project, path: "src/example.ts" })
    assert.ok(events.some(e => e.t === "file_preview" && e.path === "src/example.ts" && e.content === "export const value = 1\n"))
    readFilePreview(ctx, { t: "read_file", cwd: project, path: "src/binary.bin" })
    readFilePreview(ctx, { t: "read_file", cwd: project, path: "escape/secret.ts" })
    readFilePreview(ctx, { t: "read_file", cwd: outside, path: "secret.ts" })
    assert.deepEqual(errors, ["not_text_file", "path_outside_project", "path_outside_project"])

    searchFiles(ctx, { t: "search_files", cwd: project, query: "example" })
    const result = events.find(e => e.t === "file_search_result")
    assert.deepEqual(result?.results, [{ path: "src/example.ts", type: "file" }])
    searchFiles(ctx, { t: "search_files", cwd: project, query: "secret" })
    const searches = events.filter(e => e.t === "file_search_result")
    assert.deepEqual(searches.at(-1)?.results, [])
  } finally {
    if (previousSessionsDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionsDir
    rmSync(root, { recursive: true, force: true })
  }
})
