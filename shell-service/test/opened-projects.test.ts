import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { openProject } from "../src/commands/session.js"
import { pidForCwd } from "../src/project-scanner.js"
import type { Ctx } from "../src/commands/context.js"

test("an opened project with no Pi session survives a service restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-opened-"))
  const priorAgentDir = process.env.PI_CODING_AGENT_DIR
  const priorSessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR
  try {
    process.env.PI_CODING_AGENT_DIR = root
    delete process.env.PI_CODING_AGENT_SESSION_DIR
    const cwd = join(root, "empty-project")
    mkdirSync(cwd)
    const errors: string[] = []
    const ctx = {
      cwdOrError: async () => cwd,
      broadcast: () => {},
      send: () => {},
      fail: (code: string) => errors.push(code),
    } as unknown as Ctx
    await openProject(ctx, { t: "open_project", cwd })
    assert.deepEqual(errors, [])
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      'import { scanProjects } from "./src/project-scanner.ts"; console.log(JSON.stringify(scanProjects()))',
    ], { cwd: join(import.meta.dirname, ".."), env: process.env, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const projects = JSON.parse(result.stdout) as Array<{ id: string; cwd: string; sessionCount: number }>
    assert.deepEqual(projects.map(p => ({ id: p.id, cwd: p.cwd, sessionCount: p.sessionCount })),
      [{ id: pidForCwd(cwd), cwd: realpathSync(cwd), sessionCount: 0 }])
    assert.ok(readFileSync(join(root, "pi-ui-projects.json"), "utf8").includes(cwd))
  } finally {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir
    if (priorSessionsDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = priorSessionsDir
    rmSync(root, { recursive: true, force: true })
  }
})
