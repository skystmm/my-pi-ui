import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { test } from "node:test"
import { chooseProjectDirectory } from "../src/directory-picker.js"
import { browseDirectories, createDirectory } from "../src/commands/browse-directories.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("in-app directory browser lists folders and supports parent navigation", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-browse-"))
  const events: ShellEvent[] = []
  const errors: string[] = []
  const ctx = { send: (event: ShellEvent) => events.push(event), fail: (code: string) => errors.push(code) } as Ctx
  try {
    mkdirSync(join(root, "subfolder"))
    writeFileSync(join(root, "file.txt"), "not a directory")
    browseDirectories(ctx, { t: "browse_directories", path: root })
    assert.equal(events[0]?.t, "browse_directories_result")
    if (events[0]?.t !== "browse_directories_result") return
    assert.deepEqual(events[0].directories, ["subfolder"])
    assert.equal(events[0].cwd, realpathSync(root))
    assert.equal(events[0].parent, dirname(realpathSync(root)))
    browseDirectories(ctx, { t: "browse_directories", path: "relative" })
    assert.deepEqual(errors, ["invalid_directory"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("new folder is created inside the chosen parent and can be browsed", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-new-folder-"))
  const events: ShellEvent[] = []
  const errors: string[] = []
  const ctx = { send: (event: ShellEvent) => events.push(event), fail: (code: string) => errors.push(code) } as Ctx
  try {
    createDirectory(ctx, { t: "create_directory", parent: root, name: "新项目" })
    const created = join(root, "新项目")
    assert.equal(existsSync(created), true)
    assert.deepEqual(events, [{ t: "directory_created", cwd: realpathSync(created) }])
    browseDirectories(ctx, { t: "browse_directories", path: created })
    assert.equal(events[1]?.t, "browse_directories_result")

    createDirectory(ctx, { t: "create_directory", parent: root, name: `../${basename(root)}-escape` })
    createDirectory(ctx, { t: "create_directory", parent: root, name: "." })
    createDirectory(ctx, { t: "create_directory", parent: root, name: "新项目" })
    assert.deepEqual(errors, ["invalid_directory_name", "invalid_directory_name", "directory_exists"])
    assert.equal(existsSync(join(root, "..", `${basename(root)}-escape`)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("native folder picker returns a path without requiring typed input", async () => {
  let invocation: { file: string; args: string[] } | undefined
  const picked = await chooseProjectDirectory(async (file, args) => {
    invocation = { file, args }
    return { stdout: "/Users/sky/My Project/\n" }
  })
  assert.equal(invocation?.file, "osascript")
  assert.ok(invocation?.args[1]?.includes("choose folder"))
  assert.equal(picked, "/Users/sky/My Project")
})

test("cancelling the native folder picker leaves project selection unchanged", async () => {
  const picked = await chooseProjectDirectory(async () => {
    throw new Error("execution error: User canceled. (-128)")
  })
  assert.equal(picked, null)
})

test("native folder picker rejects a non-absolute result", async () => {
  await assert.rejects(
    chooseProjectDirectory(async () => ({ stdout: "relative/path\n" })),
    /绝对路径/,
  )
})
