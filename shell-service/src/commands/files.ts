// File listing for the Files pane. Reads the real filesystem, but only inside a
// project the client has open — the Shell Service can be bound to a remote
// interface in the future, so an unrestricted browse command would be a hole.
import { readdirSync, statSync, existsSync, realpathSync } from "node:fs"
import { join, relative, isAbsolute, normalize } from "node:path"
import { canonCwd } from "../project-scanner.js"
import { isPathInside } from "../path-boundary.js"
import type { Ctx } from "./context.js"
import type { ShellCommand } from "../ws-protocol.js"

const MAX_ENTRIES = 400

/** Resolve `sub` inside `root`; returns null when it escapes the root. */
function resolveInside(root: string, sub: string): string | null {
  const base = canonCwd(root)
  const rel = normalize(sub ?? "").replace(/^([/\\])+/, "")
  const target = isAbsolute(sub ?? "") ? normalize(sub) : join(base, rel)
  if (!isPathInside(base, target)) return null
  if (!existsSync(target)) return target // listDir reports path_not_found
  // Check the physical path too: readdir/stat follow directory symlinks.
  try {
    if (!isPathInside(realpathSync(base), realpathSync(target))) return null
  } catch { return null }
  return target
}

export function listDir(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_dir" }>) {
  const target = resolveInside(cmd.cwd, cmd.path ?? "")
  if (!target) return ctx.fail("path_outside_project", "只能浏览当前项目目录内的路径")
  if (!existsSync(target)) return ctx.fail("path_not_found", `目录不存在：${cmd.path ?? "."}`)

  try {
    const st = statSync(target)
    if (!st.isDirectory()) return ctx.fail("not_a_directory", `${cmd.path ?? "."} 不是目录`)
    const dirents = readdirSync(target, { withFileTypes: true })
    const entries = dirents
      .map(d => {
        const full = join(target, d.name)
        let size = 0
        let mtime = 0
        try { const s = statSync(full); size = s.size; mtime = s.mtimeMs } catch { /* raced away */ }
        return {
          name: d.name,
          type: (d.isDirectory() ? "dir" : "file") as "dir" | "file",
          size,
          mtime,
        }
      })
      // directories first, then files, each alphabetically (dotfiles last)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1
        const ad = a.name.startsWith("."), bd = b.name.startsWith(".")
        if (ad !== bd) return ad ? 1 : -1
        return a.name.localeCompare(b.name)
      })
      .slice(0, MAX_ENTRIES)

    ctx.send({
      t: "dir_listing",
      cwd: canonCwd(cmd.cwd),
      path: relative(canonCwd(cmd.cwd), target),
      entries,
      truncated: dirents.length > MAX_ENTRIES,
    })
  } catch (e) {
    ctx.fail("list_dir_failed", (e as Error)?.message ?? "readdir failed")
  }
}
