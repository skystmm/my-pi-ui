// File listing for the Files pane. Reads the real filesystem, but only inside a
// known Pi UI project — the Shell Service can be bound to a remote
// interface in the future, so an unrestricted browse command would be a hole.
import { readdirSync, statSync, existsSync, realpathSync, openSync, readSync, closeSync, type Dirent } from "node:fs"
import { join, relative, isAbsolute, normalize } from "node:path"
import { canonCwd, scanProjects } from "../project-scanner.js"
import { isPathInside } from "../path-boundary.js"
import type { Ctx } from "./context.js"
import type { ShellCommand } from "../ws-protocol.js"

const MAX_ENTRIES = 400
const MAX_PREVIEW_BYTES = 256 * 1024
const MAX_SEARCH_RESULTS = 100
const MAX_SEARCH_VISITS = 5000

/** Resolve `sub` inside `root`; returns null when it escapes the root. */
function resolveInside(root: string, sub: string): string | null {
  const base = canonCwd(root)
  if (!scanProjects().some(project => project.cwd === base)) return null
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

/** Read a bounded UTF-8 text preview, following links only within the project. */
export function readFilePreview(ctx: Ctx, cmd: Extract<ShellCommand, { t: "read_file" }>) {
  const target = resolveInside(cmd.cwd, cmd.path)
  if (!target) return ctx.fail("path_outside_project", "只能预览当前项目目录内的文件")
  if (!existsSync(target)) return ctx.fail("path_not_found", `文件不存在：${cmd.path}`)
  let fd: number | undefined
  try {
    const st = statSync(target)
    if (!st.isFile()) return ctx.fail("not_a_file", "请选择文本文件")
    fd = openSync(target, "r")
    const bytes = Buffer.alloc(Math.min(st.size, MAX_PREVIEW_BYTES))
    let count = 0
    while (count < bytes.length) {
      const next = readSync(fd, bytes, count, bytes.length - count, count)
      if (!next) break
      count += next
    }
    const data = bytes.subarray(0, count)
    if (data.includes(0)) return ctx.fail("not_text_file", "该文件不是可预览的 UTF-8 文本")
    const truncated = st.size > count
    const content = new TextDecoder("utf-8", { fatal: true }).decode(data, { stream: truncated })
    ctx.send({ t: "file_preview", cwd: canonCwd(cmd.cwd), path: relative(canonCwd(cmd.cwd), target), content, truncated })
  } catch (error) {
    if (error instanceof TypeError) return ctx.fail("not_text_file", "该文件不是可预览的 UTF-8 文本")
    ctx.fail("read_file_failed", (error as Error).message)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Search names with bounded traversal; symlinks are skipped to avoid escapes and cycles. */
export function searchFiles(ctx: Ctx, cmd: Extract<ShellCommand, { t: "search_files" }>) {
  const root = resolveInside(cmd.cwd, "")
  if (!root) return ctx.fail("path_outside_project", "项目目录不可用")
  const query = typeof cmd.query === "string" ? cmd.query.trim().slice(0, 120) : ""
  if (!query) return ctx.fail("invalid_query", "请输入搜索内容")
  const results: { path: string; type: "dir" | "file" }[] = []
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let visited = 0
  let truncated = false
  const needle = query.toLocaleLowerCase()
  try {
    while (pending.length && visited < MAX_SEARCH_VISITS && results.length < MAX_SEARCH_RESULTS) {
      const current = pending.shift()!
      let entries: Dirent<string>[]
      try { entries = readdirSync(current.path, { withFileTypes: true }) }
      catch (error) {
        if (current.depth === 0) throw error
        truncated = true
        continue
      }
      for (const entry of entries) {
        if (++visited > MAX_SEARCH_VISITS) break
        if (entry.isSymbolicLink()) continue
        const full = join(current.path, entry.name)
        const type = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : null
        if (!type) continue
        if (entry.name.toLocaleLowerCase().includes(needle)) {
          results.push({ path: relative(root, full), type })
          if (results.length >= MAX_SEARCH_RESULTS) break
        }
        if (type === "dir" && current.depth < 12 && entry.name !== ".git" && entry.name !== "node_modules") {
          pending.push({ path: full, depth: current.depth + 1 })
        } else if (type === "dir" && current.depth >= 12) {
          truncated = true
        }
      }
    }
    ctx.send({ t: "file_search_result", cwd: canonCwd(cmd.cwd), query, results, truncated: truncated || pending.length > 0 || visited >= MAX_SEARCH_VISITS || results.length >= MAX_SEARCH_RESULTS })
  } catch (error) {
    ctx.fail("search_files_failed", (error as Error).message)
  }
}
