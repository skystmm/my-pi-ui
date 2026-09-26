import { useEffect, useState } from "react"
import { wsClient } from "../../lib/ws-client"
import { useDirListing } from "../../stores/appStore"

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
  const listing = useDirListing()

  useEffect(() => { setPath("") }, [cwd])
  useEffect(() => {
    if (cwd) wsClient.send({ t: "list_dir", cwd, path })
  }, [cwd, path])

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
          <div className="p-1.5 max-h-[320px] overflow-auto">
            {!current ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">读取中…</div>
            ) : current.entries.length === 0 ? (
              <div className="mono text-[11px] text-zinc-600 p-3 text-center">空目录</div>
            ) : (
              <div className="space-y-0.5">
                {current.entries.map(e => (
                  <button
                    key={e.name}
                    onClick={() => { if (e.type === "dir") setPath(path ? `${path}/${e.name}` : e.name) }}
                    disabled={e.type !== "dir"}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded mono text-[11px] text-left ${e.type === "dir" ? "hover:bg-[var(--bg-hover)] text-zinc-300" : "text-zinc-500"}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${e.type === "dir" ? "bg-sky-500" : "bg-zinc-600"}`} />
                    <span className="truncate flex-1">{e.name}</span>
                    {e.type === "file" && <span className="text-zinc-600 shrink-0">{fmtSize(e.size)}</span>}
                  </button>
                ))}
              </div>
            )}
            {current?.truncated && <div className="mono text-[10px] text-zinc-600 px-2 py-1">已截断（仅显示前 400 项）</div>}
          </div>
        </>
      )}
      <div className="px-3 py-2 mono text-[10px] text-zinc-600 border-t leading-relaxed" style={{ borderColor: "var(--border)" }}>
        真实 readdir（Shell Service），仅限当前项目目录内
      </div>
    </div>
  )
}
