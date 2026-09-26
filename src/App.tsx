import { useEffect, useMemo, useRef, useState } from "react"
import { wsClient } from "./lib/ws-client"
import { builtinCommands, outgoingPrompt, parseBuiltinCommand } from "./lib/builtin-commands"
import {
  useProjects, useProviders, useModels, useLastError, useSessionEntries, useSessions,
  useExtensions, useSkills, useSessionStats, useSessionStream, useSessionLeaf,
  useActiveModel, getState,
} from "./stores/appStore"
import { ProviderDrawer } from "./features/model-config"
import { ExtensionPanel, ExtensionUIOverlay } from "./features/extensions"
import { ShellHeader } from "./features/shell/ShellHeader"
import { ProjectSidebar } from "./features/shell/ProjectSidebar"
import { ProjectDirectoryPicker } from "./features/shell/ProjectDirectoryPicker"
import { Transcript, type Attachment } from "./features/shell/Transcript"
import { RightRail, type RailTab } from "./features/shell/RightRail"
import type { ProviderDraft } from "./features/model-config/types"
import type { ModelEntry, ProjectMeta, ThinkingLevel, ShellEvent, SlashCommandEntry } from "./lib/ws-protocol"

type DirectoryListing = Extract<ShellEvent, { t: "browse_directories_result" }>

export default function App() {
  // ---- data from the Shell Service (never from local guesses) ---------------
  const allProjects = useProjects()
  const projects = allProjects.filter(p => !p.archived)
  const archivedProjects = allProjects.filter(p => p.archived)
  const providers = useProviders()
  const models = useModels()
  const extensions = useExtensions()
  const skills = useSkills()
  const lastError = useLastError()

  // ---- ui state ------------------------------------------------------------
  const [projectId, setProjectId] = useState("")
  const [sessionId, setSessionId] = useState("")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [railTab, setRailTab] = useState<RailTab>("tree")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [extensionDrawerOpen, setExtensionDrawerOpen] = useState(false)
  const [settingsScope, setSettingsScope] = useState<"global" | "project">("global")
  const [toast, setToast] = useState<string | null>(null)
  const [composerText, setComposerText] = useState("")
  const [slashCommands, setSlashCommands] = useState<SlashCommandEntry[]>([])
  const [modelMenuRequest, setModelMenuRequest] = useState(0)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerMode, setComposerMode] = useState<"plan" | "build">("plan")
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pickingDir, setPickingDir] = useState(false)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [openingDirectory, setOpeningDirectory] = useState(false)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingOpenCwd = useRef<string | null>(null)

  // ---- derived -------------------------------------------------------------
  const curProject = projects.find(p => p.id === projectId) ?? projects[0] ?? null
  const curProjectId = curProject?.id ?? ""
  const allSessions = useSessions(curProjectId)
  const curSessions = allSessions.filter(s => !s.archived)
  const archivedSessions = allSessions.filter(s => s.archived)
  const curSession = curSessions.find(s => s.id === sessionId) ?? curSessions[0] ?? null
  const effectiveSessionId = curSession?.id ?? ""
  const entries = useSessionEntries(effectiveSessionId)
  const stream = useSessionStream(effectiveSessionId)
  const leafId = useSessionLeaf(effectiveSessionId)
  const stats = useSessionStats(effectiveSessionId)
  // pi's model, not ours: it arrives with the session snapshot / model_changed,
  // and falls back to the first model pi reports as usable.
  const activeModelKey = useActiveModel(curProject?.cwd ?? "")
  const firstUsable = models.find(m => m.available)
  const shownModelKey = activeModelKey || (firstUsable ? `${firstUsable.providerId}/${firstUsable.id}` : "")
  const availableCommands = useMemo(() => [...builtinCommands, ...slashCommands.filter(c => !builtinCommands.some(b => b.name === c.name))], [slashCommands])
  const ctxUsage = stats?.contextUsage ?? null
  const ctxPercent = ctxUsage?.percent != null ? Math.max(0, Math.min(100, ctxUsage.percent)) : null
  const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`
  const fmtReserve = (n: number) => n >= 1000 && n % 1024 === 0 ? `${n / 1024}k` : `${n}`
  const reserveLabel = stats ? fmtReserve(stats.reserveTokens) : "—"
  const compactionCount = entries.filter(e => e.type === "compaction" || e.type === "branch_summary").length
  // Branch actually in context: walk parentId from the leaf back to the root.
  const branchPath = useMemo(() => {
    if (!entries.length) return entries
    const byId = new Map(entries.map(e => [e.id, e]))
    const out: typeof entries = []
    let cur: (typeof entries)[number] | undefined = (leafId ? byId.get(leafId) : undefined) ?? entries[entries.length - 1]
    let guard = 0
    while (cur && guard++ < 10000) {
      out.push(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return out.reverse()
  }, [entries, leafId])

  // ---- effects -------------------------------------------------------------
  useEffect(() => {
    if (projects.length && !projects.some(p => p.id === projectId)) setProjectId(projects[0].id)
    if (!projects.length && projectId) setProjectId("")
  }, [allProjects, projectId])

  useEffect(() => {
    if (curSessions.length && !curSessions.some(s => s.id === sessionId)) setSessionId(curSessions[0].id)
    if (!curSessions.length && sessionId) setSessionId("")
  }, [allSessions, curProjectId, sessionId])

  useEffect(() => {
    if (curProjectId) wsClient.send({ t: "list_sessions", projectId: curProjectId })
  }, [curProjectId])

  // pi's usable-model list is authoritative and per-cwd
  useEffect(() => {
    if (curProject?.cwd) wsClient.send({ t: "list_available_models", cwd: curProject.cwd })
  }, [curProject?.cwd])

  useEffect(() => {
    setSlashCommands([])
    if (curProject?.cwd) wsClient.send({ t: "list_slash_commands", cwd: curProject.cwd })
  }, [curProject?.cwd])

  useEffect(() => {
    const off = wsClient.on(ev => {
      if (ev.t === "slash_commands" && ev.cwd === curProject?.cwd) setSlashCommands(ev.commands)
    })
    return off
  }, [curProject?.cwd])

  useEffect(() => {
    if (effectiveSessionId && curProjectId) {
      wsClient.send({ t: "get_session", projectId: curProjectId, sessionId: effectiveSessionId })
    }
  }, [effectiveSessionId, curProjectId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrawerOpen(false); setExtensionDrawerOpen(false); setModeMenuOpen(false); if (!openingDirectory && !creatingDirectory) setDirectoryBrowserOpen(false) }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [openingDirectory, creatingDirectory])

  // provider_saved → the Shell Service already wrote models.json + auth.json;
  // ask pi for the freshly usable model list so the menu shows reality.
  useEffect(() => {
    const off = wsClient.on(ev => {
      if (ev.t !== "provider_saved") return
      setToast(`${ev.name} 已写入 pi 配置（models.json + auth.json）${ev.models.length ? ` · ${ev.models.length} 个模型` : ""}`)
      const cwd = getState().projects[0]?.cwd
      if (cwd) wsClient.send({ t: "list_available_models", cwd })
    })
    return off
  }, [])

  // session_created → auto-select the new session
  useEffect(() => {
    const off = wsClient.on(ev => {
      if (ev.t !== "session_created") return
      setProjectId(ev.projectId)
      setSessionId(ev.sessionId)
      setToast(`新会话已创建 · ${ev.sessionId.slice(0, 16)}…`)
    })
    return off
  }, [])

  // Native picker returns a path; open_project validates it and reports the canonical project.
  useEffect(() => {
    const off = wsClient.on(ev => {
      if (ev.t === "project_directory_picker") {
        if (ev.status === "selected") {
          pendingOpenCwd.current = ev.cwd
          wsClient.send({ t: "open_project", cwd: ev.cwd })
        } else {
          setPickingDir(false)
          if (ev.status === "error") setToast(ev.message ?? "无法打开目录选择窗口")
        }
      } else if (ev.t === "browse_directories_result") {
        setDirectoryListing(ev)
        setDirectoryLoading(false)
      } else if (ev.t === "directory_created") {
        setCreatingDirectory(false)
        setDirectoryLoading(true)
        wsClient.send({ t: "browse_directories", path: ev.cwd })
      } else if (ev.t === "project_opened" && pendingOpenCwd.current) {
        pendingOpenCwd.current = null
        setPickingDir(false)
        setOpeningDirectory(false)
        setDirectoryBrowserOpen(false)
        setProjectId(ev.projectId)
        const hit = getState().projects.find(p => p.id === ev.projectId)
        setToast(`已打开 ${hit?.displayName ?? ev.cwd} · trust: ${hit?.trust ?? "unknown"}`)
      } else if (ev.t === "error" && pendingOpenCwd.current) {
        pendingOpenCwd.current = null
        setPickingDir(false)
        setOpeningDirectory(false)
        setCreatingDirectory(false)
      } else if (ev.t === "error") {
        setDirectoryLoading(false)
        setCreatingDirectory(false)
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (lastError) setToast(`${lastError.code}: ${lastError.message}`)
  }, [lastError])

  // ---- handlers ------------------------------------------------------------
  const requireReady = (): boolean => {
    if (!wsClient.ready) { setToast("Shell Service 未连接（127.0.0.1:5174）· 请确认已启动"); return false }
    return true
  }

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return
    const imgs = [...files].filter(f => f.type.startsWith("image/"))
    if (!imgs.length) { setToast("仅支持图片附件"); return }
    if (attachments.length + imgs.length > 4) { setToast("最多 4 张图片"); return }
    const over = imgs.find(f => f.size > 5 * 1024 * 1024)
    if (over) { setToast(`图片过大（>5MB）：${over.name}`); return }
    void Promise.all(imgs.map(f => new Promise<Attachment>((res, rej) => {
      const r = new FileReader()
      r.onload = () => {
        const url = String(r.result ?? "")
        const b64 = url.includes(",") ? url.split(",")[1] : url
        res({ name: f.name, mimeType: f.type || "image/png", data: b64 })
      }
      r.onerror = () => rej(new Error("read failed"))
      r.readAsDataURL(f)
    }))).then(items => setAttachments(prev => [...prev, ...items])).catch(() => setToast("图片读取失败"))
  }

  const handleAddProvider = (draft: ProviderDraft, modelsToAdd: { id: string; displayName: string; thinking: ThinkingLevel }[], apiKey?: string) => {
    // One command carries provider + models + credential: the Shell Service mints
    // the pi provider id, validates models.json, writes auth.json (0600), then
    // respawns pi so the new catalog is live. The key never enters React state.
    wsClient.send({
      t: "upsert_provider",
      provider: {
        name: draft.name,
        type: draft.type,
        baseUrl: draft.baseUrl.trim() || undefined,
        auth: draft.auth,
        apiKey,
        envVar: draft.auth === "env" ? draft.envVar : undefined,
        models: modelsToAdd.map(m => ({ id: m.id, displayName: m.displayName })),
      },
    })
    setToast("正在写入 pi 配置 …")
  }

  const handleRemoveProvider = (id: string) => {
    const p = providers.find(x => x.id === id)
    if (!p) return
    const ok = confirm(`从 pi 配置中移除 ${p.name}？\n会删除 ~/.pi/agent/models.json 里的该 provider 及 auth.json 中对应凭据`)
    if (!ok) return
    wsClient.send({ t: "remove_provider", providerId: id })
    setToast(`已移除 ${p.name}`)
  }

  const handleSelectModel = (m: ModelEntry) => {
    const key = `${m.providerId}/${m.id}`
    wsClient.send({ t: "set_default_model", cwd: curProject?.cwd, provider: m.providerId, modelId: m.id, thinking: m.thinkingDefault })
    setToast(`已切换至 ${key}${m.available === false ? "（pi 未就绪：缺凭据）" : ""}`)
  }

  const sendComposer = () => {
    const msg = composerText.trim()
    if (!msg && !attachments.length) return
    if (!curProject?.cwd) { handlePickDirectory(); return }
    if (!requireReady()) return
    const builtin = parseBuiltinCommand(msg)
    if (builtin) {
      if (attachments.length) { setToast("内置命令不能附带图片"); return }
      const { name, args } = builtin
      if (name === "model") {
        if (!args) setModelMenuRequest(n => n + 1)
        else {
          const model = models.find(m => `${m.providerId}/${m.id}` === args)
          if (!model) { setToast(`未找到模型：${args}`); return }
          handleSelectModel(model)
        }
      } else if (name === "thinking") {
        if (!(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as string[]).includes(args)) { setToast("用法：/thinking off|minimal|low|medium|high|xhigh|max"); return }
        wsClient.send({ t: "set_thinking", cwd: curProject.cwd, level: args as ThinkingLevel })
        setToast(`思考级别已设为 ${args}`)
      } else if (name === "new") {
        if (args) { setToast("用法：/new"); return }
        wsClient.send({ t: "create_session", cwd: curProject.cwd })
      } else if (name === "compact") {
        if (!effectiveSessionId) { setToast("请先创建或选择会话"); return }
        wsClient.send({ t: "compact", cwd: curProject.cwd, customInstructions: args || undefined })
      } else if (name === "clone") {
        if (args) { setToast("用法：/clone"); return }
        if (!effectiveSessionId) { setToast("请先创建或选择会话"); return }
        wsClient.send({ t: "clone", cwd: curProject.cwd })
      } else if (name === "fork") {
        if (args) { setToast("用法：/fork"); return }
        if (!leafId) { setToast("当前会话没有可分支的消息"); return }
        wsClient.send({ t: "fork", cwd: curProject.cwd, fromEntryId: leafId })
      } else if (name === "tree") {
        if (args) { setToast("用法：/tree"); return }
        setRailCollapsed(false)
        setRailTab("tree")
      }
      setComposerText("")
      return
    }
    const outgoing = outgoingPrompt(msg, composerMode)
    wsClient.send({
      t: "prompt",
      cwd: curProject.cwd,
      projectId: curProjectId,
      sessionId: effectiveSessionId || undefined,
      message: outgoing,
      images: attachments.map(a => ({ type: "image", data: a.data, mimeType: a.mimeType })),
    })
    setComposerText("")
    setAttachments([])
  }

  const handlePickDirectory = () => {
    if (!requireReady()) return
    setDirectoryBrowserOpen(true)
    setDirectoryLoading(true)
    setDirectoryListing(null)
    wsClient.send({ t: "browse_directories" })
  }

  const handleBrowseDirectory = (path?: string) => {
    if (!requireReady()) return
    setDirectoryLoading(true)
    wsClient.send(path === undefined ? { t: "browse_directories" } : { t: "browse_directories", path })
  }

  const handleChooseDirectory = (cwd: string) => {
    if (!requireReady()) return
    pendingOpenCwd.current = cwd
    setOpeningDirectory(true)
    wsClient.send({ t: "open_project", cwd })
  }

  const handleCreateDirectory = (parent: string, name: string) => {
    if (!requireReady()) return
    setCreatingDirectory(true)
    wsClient.send({ t: "create_directory", parent, name })
  }

  const handleNativePickDirectory = () => {
    if (!requireReady()) return
    if (pickingDir) return
    setPickingDir(true)
    wsClient.send({ t: "pick_project_directory" })
  }

  const handleNewSession = () => {
    if (!curProject?.cwd) { handlePickDirectory(); return }
    if (!requireReady()) return
    wsClient.send({ t: "create_session", cwd: curProject.cwd })
    setToast("正在创建会话 …")
  }

  const handleSelectProject = (p: ProjectMeta) => {
    setProjectId(p.id)
    const s = getState().sessionsByProject[p.id]?.find(s => !s.archived)
    setSessionId(s?.id ?? "")
  }

  const handleArchiveProject = (p: ProjectMeta, archived: boolean) => {
    if (!requireReady()) return
    wsClient.send({ t: "set_project_archived", projectId: p.id, archived })
  }

  const handleArchiveSession = (id: string, archived: boolean) => {
    if (!curProjectId || !requireReady()) return
    wsClient.send({ t: "set_session_archived", projectId: curProjectId, sessionId: id, archived })
  }

  const handleTrustProject = (trusted: boolean) => {
    if (!curProject?.cwd) return
    wsClient.send({ t: "trust_project", cwd: curProject.cwd, trusted })
    setToast(trusted ? `已信任 ${curProject.displayName}` : `已标记不信任 ${curProject.displayName}`)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      <ShellHeader
        curProject={curProject}
        curSession={curSession}
        projectCount={projects.length}
        stats={stats}
        ctxPercent={ctxPercent}
        reserveLabel={reserveLabel}
        providers={providers}
        models={models}
        activeModelKey={shownModelKey}
        extensions={extensions}
        skills={skills}
        sidebarCollapsed={sidebarCollapsed}
        railCollapsed={railCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onToggleRail={() => setRailCollapsed(!railCollapsed)}
        onOpenExtensionDrawer={() => setExtensionDrawerOpen(true)}
        onOpenModelDrawer={() => setDrawerOpen(true)}
        onSelectModel={handleSelectModel}
        modelMenuRequest={modelMenuRequest}
        onTrustProject={() => handleTrustProject(true)}
      />

      <div className="flex flex-1 min-h-0">
        {!sidebarCollapsed && (
          <ProjectSidebar
            projects={projects}
            archivedProjects={archivedProjects}
            projectId={projectId}
            curProject={curProject}
            curSessions={curSessions}
            archivedSessions={archivedSessions}
            sessionId={sessionId}
            curSession={curSession}
            activeModelKey={shownModelKey}
            providerCount={providers.length}
            modelCount={models.length}
            extensionCount={extensions.length}
            skillCount={skills.length}
            lastErrorCode={lastError?.code}
            pickingDir={pickingDir}
            onPickDir={handlePickDirectory}
            onSelectProject={handleSelectProject}
            onArchiveProject={handleArchiveProject}
            onSelectSession={setSessionId}
            onArchiveSession={handleArchiveSession}
            onNewSession={handleNewSession}
            onOpenModelDrawer={() => setDrawerOpen(true)}
            onOpenExtensionDrawer={() => setExtensionDrawerOpen(true)}
            onTrustProject={handleTrustProject}
          />
        )}

        <Transcript
          entries={entries}
          stream={stream}
          leafId={leafId}
          curSession={curSession}
          activeModelKey={shownModelKey}
          cwd={curProject?.cwd ?? ""}
          projectDisplayName={curProject?.displayName ?? "未打开项目"}
          projectCount={projects.length}
          composerText={composerText}
          slashCommands={availableCommands}
          composerFocused={composerFocused}
          composerMode={composerMode}
          modeMenuOpen={modeMenuOpen}
          attachments={attachments}
          fileRef={fileRef}
          onComposerText={setComposerText}
          onComposerFocus={setComposerFocused}
          onComposerMode={setComposerMode}
          onModeMenu={setModeMenuOpen}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={i => setAttachments(prev => prev.filter((_, j) => j !== i))}
          onSend={sendComposer}
          onAbort={() => { if (curProject?.cwd) wsClient.send({ t: "abort", cwd: curProject.cwd }) }}
        />

        {!railCollapsed && (
          <RightRail
            tab={railTab}
            onTabChange={setRailTab}
            entries={entries}
            leafId={leafId}
            branchPath={branchPath}
            stats={stats}
            ctxPercent={ctxPercent}
            reserveLabel={reserveLabel}
            compactionCount={compactionCount}
            fmtK={fmtK}
            extensions={extensions}
            skills={skills}
            cwd={curProject?.cwd ?? ""}
            onFork={() => { if (curProject?.cwd && leafId) wsClient.send({ t: "fork", cwd: curProject.cwd, fromEntryId: leafId }) }}
            onClone={() => { if (curProject?.cwd) wsClient.send({ t: "clone", cwd: curProject.cwd }) }}
            onOpenExtensionDrawer={() => setExtensionDrawerOpen(true)}
          />
        )}
      </div>

      <ProviderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        providers={providers}
        models={models}
        onAddProvider={handleAddProvider}
        onRemoveProvider={handleRemoveProvider}
      />

      <ExtensionPanel
        open={extensionDrawerOpen}
        onClose={() => setExtensionDrawerOpen(false)}
        extensions={extensions}
        skills={skills}
        scope={settingsScope}
        onScopeChange={setSettingsScope}
        projectCwd={curProject?.cwd}
        projectTrusted={curProject?.trust === "trusted"}
        onTrustProject={() => handleTrustProject(true)}
      />
      <ExtensionUIOverlay />

      {directoryBrowserOpen && <ProjectDirectoryPicker
        listing={directoryListing}
        loading={directoryLoading}
        opening={openingDirectory}
        creating={creatingDirectory}
        nativePicking={pickingDir}
        onBrowse={handleBrowseDirectory}
        onChoose={handleChooseDirectory}
        onCreate={handleCreateDirectory}
        onNativePick={handleNativePickDirectory}
        onClose={() => setDirectoryBrowserOpen(false)}
      />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-3.5 py-2 rounded-full border shadow-lg mono text-[12px] text-zinc-200" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          {toast}
        </div>
      )}
    </div>
  )
}
