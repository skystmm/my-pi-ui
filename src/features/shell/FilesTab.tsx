import { useEffect, useState } from "react"
import { wsClient } from "../../lib/ws-client"
import { useDirListing } from "../../stores/appStore"
import type { ShellEvent } from "../../lib/ws-protocol"

type Preview = Extract<ShellEvent, { t: "file_preview" }>
type SearchResult = Extract<ShellEvent, { t: "file_search_result" }>

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Real file browser: lists the project directory through the Shell Service
 * (list_dir is restricted to paths inside the open project).
 */
export function FilesTab({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("")
  const [filePath, setFilePath] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<SearchResult | null>(null)
  const [searchError, setSearchError] = useState("")
  const listing = useDirListing()

  useEffect(() => { setPath(""); setFilePath(""); setPreview(null); setQuery(""); setSearch(null) }, [cwd])
  useEffect(() => {
    if (cwd) wsClient.send({ t: "list_dir", cwd, path })
  }, [cwd, path])
  useEffect(() => {
    if (!cwd || !filePath) return
    setPreview(null)
    setPreviewError("")
    wsClient.send({ t: "read_file", cwd, path: filePath })
  }, [cwd, filePath])
  useEffect(() => {
    if (!cwd || !query.trim()) { setSearch(null); setSearchError(""); return }
    const timer = setTimeout(() => wsClient.send({ t: "search_files", cwd, query: query.trim() }), 220)
    return () => clearTimeout(timer)
  }, [cwd, query])
  useEffect(() => wsClient.on(ev => {
    if (ev.t === "file_preview" && ev.cwd === cwd && ev.path === filePath) setPreview(ev)
    if (ev.t === "file_search_result" && ev.cwd === cwd && ev.query === query.trim()) setSearch(ev)
    if (ev.t === "error" && filePath && ["path_outside_project", "path_not_found", "not_text_file", "not_a_file", "read_file_failed"].includes(ev.code)) setPreviewError(ev.message)
    if (ev.t === "error" && query.trim() && ev.code === "search_files_failed") setSearchError(ev.message)
  }), [cwd, filePath, query])

  const current = listing && listing.cwd === cwd && listing.path === path ? listing : null
  const parts = path ? path.split("/") : []
  const upTo = (i: number) => parts.slice(0, i).join("/")

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="px-3 py-2 mono text-[11px] text-zinc-500 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <span>EXPLORER</span>
        <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] border" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>{cwd || "未打开项目"}</span>
      </div>
      {!cwd ? (
        <div className="mono text-[11px] text-zinc-600 p-3 text-center">先打开一个项目目录</div>
      ) : (
        <>
          <div className="px-2 py-1.5 border-b flex items-center gap-1 flex-wrap mono text-[11px]" style={{ borderColor: "var(--border)" }}>
            <button onClick={() => setPath("")} className={`px-1 rounded hover:bg-[var(--bg-hover)] ${path ? "text-zinc-500" : "text-zinc-200"}`}>根</button>
            {parts.map((p, i) => (
              <span key={`${p}-${i}`} className="flex items-center gap-1">
                <span className="text-zinc-600">/</span>
                <button onClick={() => setPath(upTo(i + 1))} className={`px-1 rounded hover:bg-[var(--bg-hover)] ${i === parts.length - 1 ? "text-zinc-200" : "text-zinc-500"}`}>{p}</button>
              </span>
            ))}
            <button onClick={() => wsClient.send({ t: "list_dir", cwd, path })} className="ml-auto px-1.5 rounded border text-[10px] text-zinc-400 hover:text-zinc-200" style={{ borderColor: "var(--border)" }}>刷新</button>
          </div>
          <div className="px-2 py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <input value={query} onChange={e => { setQuery(e.target.value); setSearch(null); setSearchError("") }} placeholder="搜索文件或目录名称" aria-label="搜索项目文件" className="w-full rounded border px-2 py-1 bg-transparent mono text-[11px] text-zinc-200 outline-none" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="p-1.5 max-h-[320px] overflow-auto">
            {query.trim() ? searchError ? (
              <div className="mono text-[11px] text-red-400 p-3 text-center">{searchError}</div>
            ) : !search ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">搜索中…</div>
            ) : search.results.length === 0 ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">没有匹配项</div>
            ) : (
              <div className="space-y-0.5">{search.results.map(result => (
                <button key={result.path} onClick={() => {
                  setQuery("")
                  if (result.type === "dir") setPath(result.path)
                  else { setPath(result.path.split("/").slice(0, -1).join("/")); setFilePath(result.path) }
                }} className="w-full text-left truncate px-2 py-1 rounded mono text-[11px] text-zinc-300 hover:bg-[var(--bg-hover)]">
                  {result.type === "dir" ? "▸" : "·"} {result.path}
                </button>
              ))}</div>
            ) : !current ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">读取中…</div>
            ) : current.entries.length === 0 ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">空目录</div>
            ) : (
              <div className="space-y-0.5">
                {current.entries.map(e => (
                  <button
                    key={e.name}
                    onClick={() => { if (e.type === "dir") { setPath(path ? `${path}/${e.name}` : e.name); setFilePath("") } else setFilePath(path ? `${path}/${e.name}` : e.name) }}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded mono text-[11px] text-left hover:bg-[var(--bg-hover)] text-zinc-300"
                  >
                    <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${e.type === "dir" ? "bg-sky-500" : "bg-zinc-600"}`} />
                    <span className="truncate flex-1">{e.name}</span>
                    {e.type === "file" && <span className="text-zinc-600 shrink-0">{fmtSize(e.size)}</span>}
                  </button>
                ))}
              </div>
            )}
            {current?.truncated && <div className="mono text-[10px] text-zinc-600 px-2 py-1">已截断（仅显示前 400 项）</div>}
            {search?.truncated && query.trim() && <div className="mono text-[10px] text-zinc-600 px-2 py-1">搜索结果已截断</div>}
          </div>
          {filePath && <div className="border-t" style={{ borderColor: "var(--border)" }}>
            <div className="px-3 py-2 flex items-center gap-2 mono text-[11px] text-zinc-400">
              <span className="truncate flex-1" title={filePath}>{filePath}</span>
              <button onClick={() => setFilePath("")} aria-label="关闭文件预览" className="text-zinc-500 hover:text-zinc-200">×</button>
            </div>
            {previewError ? <div className="px-3 pb-3 text-[11px] text-red-400">{previewError}</div> : preview ? (
              <><pre className="px-3 pb-3 max-h-[400px] overflow-auto mono text-[11px] text-zinc-300 whitespace-pre-wrap break-words select-text">{preview.content}</pre>
              {preview.truncated && <div className="px-3 pb-2 mono text-[10px] text-amber-400">仅显示前 256 KB</div>}</>
            ) : <div className="px-3 pb-3 mono text-[11px] text-zinc-600">读取中…</div>}
          </div>}
        </>
      )}
      <div className="px-3 py-2 mono text-[10px] text-zinc-600 border-t leading-relaxed" style={{ borderColor: "var(--border)" }}>
        文件只读预览 · 项目内名称搜索
      </div>
    </div>
  )
}
