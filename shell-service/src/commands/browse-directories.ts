import { mkdirSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import type { Ctx } from "./context.js"
import type { ShellCommand } from "../ws-protocol.js"

/** Browse directory names only. Opening a project still runs its own cwd validation. */
export function browseDirectories(ctx: Ctx, cmd: Extract<ShellCommand, { t: "browse_directories" }>) {
  const requested = cmd.path === undefined ? homedir() : cmd.path
  if (typeof requested !== "string" || !isAbsolute(requested)) {
    ctx.fail("invalid_directory", "请选择绝对目录")
    return
  }
  let cwd: string
  try {
    cwd = realpathSync(requested)
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory")
  } catch {
    ctx.fail("directory_not_found", "目录不存在或无法访问")
    return
  }
  try {
    const names = readdirSync(cwd).filter(name => {
      try { return statSync(join(cwd, name)).isDirectory() } catch { return false }
    }).sort((a, b) => a.localeCompare(b, "zh-CN"))
    ctx.send({ t: "browse_directories_result", cwd, parent: cwd === "/" ? null : dirname(cwd), directories: names.slice(0, 500), truncated: names.length > 500 })
  } catch {
    ctx.fail("directory_unreadable", "无法读取此目录")
  }
}

/** Create exactly one child folder under the directory being browsed. */
export function createDirectory(ctx: Ctx, cmd: Extract<ShellCommand, { t: "create_directory" }>) {
  const name = typeof cmd.name === "string" ? cmd.name.trim() : ""
  if (!name || name.length > 128 || name === "." || name === ".." || /[/\\\x00-\x1f\x7f]/.test(name)) {
    ctx.fail("invalid_directory_name", "文件夹名称无效")
    return
  }
  if (typeof cmd.parent !== "string" || !isAbsolute(cmd.parent)) {
    ctx.fail("invalid_directory", "请选择绝对目录")
    return
  }
  let parent: string
  try {
    parent = realpathSync(cmd.parent)
    if (!statSync(parent).isDirectory()) throw new Error("not a directory")
  } catch {
    ctx.fail("directory_not_found", "父目录不存在或无法访问")
    return
  }
  const path = join(parent, name)
  try {
    mkdirSync(path, { mode: 0o755 })
    ctx.send({ t: "directory_created", cwd: realpathSync(path) })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    ctx.fail(code === "EEXIST" ? "directory_exists" : "directory_create_failed",
      code === "EEXIST" ? "同名文件或文件夹已存在" : "无法在此目录创建文件夹")
  }
}
