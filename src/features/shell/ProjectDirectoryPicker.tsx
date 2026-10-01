import { useEffect, useState } from "react"

type Listing = { cwd: string; parent: string | null; directories: string[]; truncated: boolean }

type Props = {
  listing: Listing | null
  loading: boolean
  opening: boolean
  creating: boolean
  nativePicking: boolean
  onBrowse: (path?: string) => void
  onChoose: (path: string) => void
  onCreate: (parent: string, name: string) => void
  onNativePick: () => void
  onClose: () => void
}

export function ProjectDirectoryPicker({ listing, loading, opening, creating, nativePicking, onBrowse, onChoose, onCreate, onNativePick, onClose }: Props) {
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState("")
  useEffect(() => { setNewFolderOpen(false); setFolderName("") }, [listing?.cwd])
  const submitNewFolder = () => {
    if (listing && folderName.trim()) onCreate(listing.cwd, folderName.trim())
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onMouseDown={e => { if (!opening && !creating && e.target === e.currentTarget) onClose() }}>
    <div role="dialog" aria-modal="true" aria-label="选择项目目录" className="w-full max-w-xl rounded-xl border shadow-2xl overflow-hidden" style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex-1 text-sm font-medium">选择项目目录</div>
        <button onClick={onClose} disabled={opening || creating} aria-label="关闭目录选择" className="text-zinc-400 hover:text-white text-xl leading-none disabled:opacity-50">×</button>
      </div>
      <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
        <button onClick={() => onBrowse("/")} disabled={loading || opening || creating} className="px-2 py-1 rounded border text-xs text-zinc-300 disabled:opacity-50" style={{ borderColor: "var(--border)" }}>磁盘根目录</button>
        <button onClick={() => onBrowse()} disabled={loading || opening || creating} className="px-2 py-1 rounded border text-xs text-zinc-300 disabled:opacity-50" style={{ borderColor: "var(--border)" }}>主目录</button>
        {listing?.parent && <button onClick={() => onBrowse(listing.parent!)} disabled={loading || opening || creating} className="px-2 py-1 rounded border text-xs text-zinc-300 disabled:opacity-50" style={{ borderColor: "var(--border)" }}>↑ 上一级</button>}
        <div className="flex-1" />
        <button onClick={() => setNewFolderOpen(true)} disabled={!listing || loading || opening || creating} className="px-2 py-1 rounded border text-xs text-zinc-300 disabled:opacity-50" style={{ borderColor: "var(--border)" }}>＋ 新建文件夹</button>
      </div>
      {newFolderOpen && <div className="px-4 py-2 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <input aria-label="新文件夹名称" value={folderName} disabled={creating} onChange={e => setFolderName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitNewFolder(); if (e.key === "Escape") { e.stopPropagation(); setNewFolderOpen(false) } }} autoFocus placeholder="文件夹名称" className="flex-1 min-w-0 px-2 py-1.5 rounded border bg-[var(--bg)] text-sm focus:outline-none disabled:opacity-50" style={{ borderColor: "var(--border)" }} />
        <button onClick={submitNewFolder} disabled={!folderName.trim() || creating} className="px-3 py-1.5 rounded text-sm disabled:opacity-50" style={{ background: "#ededed", color: "#0a0a0a" }}>{creating ? "创建中…" : "创建"}</button>
        <button onClick={() => setNewFolderOpen(false)} disabled={creating} className="text-xs text-zinc-400 disabled:opacity-50">取消</button>
      </div>}
      <div className="mono px-4 py-2 text-xs text-zinc-400 truncate border-b" title={listing?.cwd} style={{ borderColor: "var(--border)" }}>{listing?.cwd ?? "正在加载目录…"}</div>
      <div className="h-72 overflow-auto p-2" aria-label="本地文件夹列表">
        {loading ? <div className="p-3 text-sm text-zinc-500">读取中…</div> : listing?.directories.length ? listing.directories.map(name =>
          <button key={name} onClick={() => onBrowse(`${listing.cwd === "/" ? "" : listing.cwd}/${name}`)} disabled={creating || opening} className="block w-full text-left px-3 py-2 rounded text-sm hover:bg-[var(--bg-muted)] truncate disabled:opacity-50" title={name}>▸ {name}</button>
        ) : <div className="p-3 text-sm text-zinc-500">此目录下没有子目录</div>}
        {listing?.truncated && <div className="px-3 py-2 text-xs text-amber-400">目录较多，仅显示前 500 个</div>}
      </div>
      <div className="px-4 py-3 border-t flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <button onClick={onNativePick} disabled={nativePicking || opening || creating} className="text-xs text-zinc-400 hover:text-white disabled:opacity-50">{nativePicking ? "系统窗口打开中…" : "使用系统窗口（macOS）"}</button>
        <div className="flex-1" />
        <button onClick={onClose} disabled={opening || creating} className="px-3 py-1.5 text-sm text-zinc-400 disabled:opacity-50">取消</button>
        <button onClick={() => listing && onChoose(listing.cwd)} disabled={!listing || loading || opening || creating} className="px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50" style={{ background: "#ededed", color: "#0a0a0a" }}>{opening ? "打开中…" : "选择此目录"}</button>
      </div>
    </div>
  </div>
}
