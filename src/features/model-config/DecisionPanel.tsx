import { EvaluationPanel } from './EvaluationPanel'
import { useEffect, useRef, useState } from 'react'
import { DecisionResult } from './DecisionResult'
import { wsClient } from '../../lib/ws-client'
import type { NativeModel, Config, Draft, Model, Provider, QType, Result } from '../../lib/system-one/types'
const initial: Config = { revision: 0, enabled: false, providers: [], models: [] }
const presets = {
  native: { name: 'Pi 原生 classifier', protocol: 'pi-native', endpoint: 'pi://typesafe', envVar: '' },
  jev: { name: 'TypeSafe Jev', protocol: 'systemone-http', endpoint: 'https://api.typesafe.ai/v1/systemone', envVar: 'TYPESAFE_API_KEY' },
  local: { name: '本地 System One', protocol: 'systemone-http', endpoint: 'http://127.0.0.1:8000/v1/systemone', envVar: '' },
  openrouter: { name: 'OpenRouter Decisions', protocol: 'openrouter-decisions', endpoint: 'https://openrouter.ai/api/alpha/decisions', envVar: 'OPENROUTER_API_KEY' },
} as const
const messages: Record<string, string> = { missing_credential: '缺少凭据，请配置 API Key 或 Shell 环境变量。', config_conflict: '其他窗口已修改配置，请刷新后重新编辑。', selection_in_use: '模型仍被默认或项目选择引用，请先切换或关闭。', disabled: '全局决策功能已关闭。', invalid_response: '模型返回的结构或概率不符合声明。', timeout: '请求超时，供应商可能仍已计费。', unauthorized: '认证失败，请核对 Key 与地址。', unsupported_capability: '模型不支持这类问题。', not_configured: '请选择决策模型。', busy: '该服务商正在处理其他请求，请稍后重试。' }
export function DecisionPanel({ cwd, openRequest, onChat }: { cwd: string; openRequest: number; onChat: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const cwdRef = useRef(cwd); cwdRef.current = cwd
  const [evalOpen, setEvalOpen] = useState(false)
  const [nativeModels, setNativeModels] = useState<NativeModel[]>([])
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<Draft>(initial)
  const [scope, setScope] = useState('global')
  const [selected, setSelected] = useState<string | null | undefined>()
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [testModel, setTestModel] = useState('')
  const request = useRef('')
  const previousReady = useRef(false)
  const watchdog = useRef<number | undefined>(undefined)
  const mark = (next: Draft) => { dirtyRef.current = true; setDirty(true); setConfig(next); setResult(null) }
  const send = (action: 'list' | 'save' | 'select' | 'test' | 'native_models', extra: Record<string, unknown> = {}) => {
    if (!wsClient.ready) { setError('Shell Service 未连接，请等待重连。'); return }
    const requestId = crypto.randomUUID(); request.current = requestId; clearTimeout(watchdog.current); watchdog.current = window.setTimeout(() => { request.current = ""; setPending(false); setError("等待响应超时，请刷新状态后重试。") }, 125000); setPending(true); setError('')
    wsClient.send({ t: 'decision_command', action, cwd: cwdRef.current, requestId, ...extra })
  }
  useEffect(() => {
    const off = wsClient.on(ev => {
      if (ev.t === 'decision_native_models') setNativeModels(ev.models)
      if (ev.t === 'decision_catalog' && !dirtyRef.current) setConfig(ev.config)
      if (ev.t === 'decision_selection' && ev.cwd === cwdRef.current) { setScope(ev.selection.scope); setSelected(ev.selection.modelId) }
      if (ev.t !== 'decision_result' || ev.requestId !== request.current) return
      clearTimeout(watchdog.current); setPending(false)
      if (!ev.ok) { if (ev.config && !dirtyRef.current) setConfig(ev.config); setError(messages[ev.code ?? ''] ?? `保存或请求失败：${ev.code}`); return }
      if (ev.config) { setConfig(ev.config); setDirty(false); dirtyRef.current = false }
      if (ev.selection) { setScope(ev.selection.scope); setSelected(ev.selection.modelId) }
      if (ev.result) setResult(ev.result as Result)
    })
    const timer = window.setInterval(() => { const ready = wsClient.ready; if (!ready) setPending(false); if (ready && !previousReady.current && !dirtyRef.current) send('list'); previousReady.current = ready }, 1000)
    return () => { off(); clearInterval(timer); clearTimeout(watchdog.current) }
  }, [])
  useEffect(() => { if (wsClient.ready && !dirtyRef.current) send('list'); const timer = window.setInterval(() => { if (wsClient.ready && !request.current && !dirtyRef.current) send('list') }, 1000); return () => clearInterval(timer) }, [cwd])
  useEffect(() => { if (openRequest) { setOpen(true); if (!dirtyRef.current) send('list') } }, [openRequest])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const controls = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])
    controls()[0]?.focus()
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close()
      if (ev.key === 'Tab') {
        const items = controls(); const first = items[0]; const last = items[items.length - 1]
        if (ev.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { ev.preventDefault(); last?.focus() }
        if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('keydown', handler); previous?.focus() }
  }, [open])
  function close() { if (dirtyRef.current && !window.confirm('放弃未保存的决策配置？')) return; setOpen(false); dirtyRef.current = false; setDirty(false); send('list') }
  const field = 'w-full rounded border p-2 text-sm bg-[var(--bg)] border-[var(--border)]'
  const button = 'rounded border px-3 py-2 text-sm disabled:opacity-40 border-[var(--border)] hover:bg-[var(--bg-hover)]'
  const updateProvider = (id: string, patch: Partial<Draft['providers'][number]>) => mark({ ...config, providers: config.providers.map(p => p.id === id ? { ...p, ...patch } : p) })
  const updateModel = (id: string, patch: Partial<Model>) => mark({ ...config, models: config.models.map(m => m.id === id ? { ...m, ...patch } : m) })
  const active = config.models.find(m => m.id === (scope === 'global' ? config.defaultModelId : selected))
  return <>
    {evalOpen && <EvaluationPanel config={config} dirty={dirty} onClose={() => setEvalOpen(false)}/>}
    <div className="flex items-center justify-end gap-2 px-4 py-1 border-b border-[var(--border)] text-xs">
      <span>决策 · {config.enabled && !(scope === 'project' && selected === null) ? active?.name ?? '未配置' : '关闭'} · {scope === 'project' ? '当前项目' : '全局'}</span>
      <select aria-label="当前项目决策模型" className="bg-[var(--bg)] border rounded p-1" disabled={pending || !cwd || dirty} value={scope === 'global' ? '__global' : selected ?? '__off'} onChange={e => send('select', { modelId: e.target.value === '__global' ? undefined : e.target.value === '__off' ? null : e.target.value })}>
        <option value="__global">跟随全局</option><option value="__off">当前项目关闭</option>
        {config.providers.map(p => <optgroup key={p.id} label={p.name}>{config.models.filter(m => m.providerId === p.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)}
      </select>
      <button className="underline" onClick={() => setEvalOpen(true)}>模型测评</button>
      <button className="underline" onClick={() => { setOpen(true); if (!dirtyRef.current) send('list') }}>决策配置</button>
    </div>
    {!open && error && <p role="alert" className="text-xs text-red-400 px-4">{error}</p>}
    {open && <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={e => { if (e.target === e.currentTarget) close() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="System One 模型与服务商" className="w-[680px] max-w-full h-full bg-[var(--bg-card)] flex flex-col shadow-xl text-[var(--fg)]">
        <header className="flex items-center justify-between p-4 border-b border-[var(--border)]"><h2>模型与服务商 · 决策</h2><button className="text-xs underline" onClick={() => { if (!dirty || window.confirm("放弃草稿并打开聊天配置？")) { dirtyRef.current = false; setDirty(false); setOpen(false); send('list'); onChat() } }}>聊天配置 →</button><button aria-label="关闭决策配置" onClick={close}>关闭</button></header>
        <div className="flex-1 overflow-auto p-4 space-y-5">
          <p className="text-xs text-zinc-400">配置决策模型供 Agent 工具调用；聊天模型保持独立。保存不调用云服务。</p>
          <label className="flex gap-2"><input disabled={pending} type="checkbox" checked={config.enabled} onChange={e => mark({ ...config, enabled: e.target.checked })}/>启用决策工具</label>
          <label className="block">全局默认模型<select className={field} disabled={pending} value={config.defaultModelId ?? ''} onChange={e => mark({ ...config, defaultModelId: e.target.value || undefined })}><option value="">未选择</option>{config.models.map(m => <option key={m.id} value={m.id}>{config.providers.find(p => p.id === m.providerId)?.name} · {m.name}</option>)}</select></label>
          <div className="flex gap-2 flex-wrap">{Object.entries(presets).map(([id, preset]) => <button disabled={pending} key={id} className={button} onClick={() => mark({ ...config, providers: [...config.providers, { id: crypto.randomUUID(), name: preset.name, endpoint: preset.endpoint, protocol: preset.protocol, piProviderId: id === 'native' ? 'typesafe' : undefined, auth: id === 'native' ? { mode: 'pi' } : id === 'local' ? { mode: 'none' } : { mode: 'env', envVar: preset.envVar }, timeoutMs: 15000 }] })}>＋ {preset.name}</button>)}</div>
          {config.providers.map(p => <fieldset disabled={pending} key={p.id} className="rounded border border-[var(--border)] p-3 space-y-3"><legend className="px-1">{p.name}</legend><p className="text-xs text-zinc-400">凭据：{p.protocol === "pi-native" ? "由 Pi 管理" : p.credentialStatus === "missing" ? "缺少凭据" : p.credentialStatus === "configured" ? "已配置" : p.credentialStatus === "pi" ? "由 Pi 管理" : "无鉴权"}</p>
            <div className="grid grid-cols-2 gap-3"><label>服务商名称<input className={field} value={p.name} onChange={e => updateProvider(p.id, { name: e.target.value })}/></label><label>调用协议<select className={field} value={p.protocol} onChange={e => updateProvider(p.id, { protocol: e.target.value as Provider['protocol'], apiKey: undefined, auth: e.target.value === 'pi-native' ? { mode: 'pi' } : { mode: 'none' } })}><option value="systemone-http">System One HTTP</option><option value="openrouter-decisions">OpenRouter Decisions</option><option value="pi-native">Pi 原生 classifier</option></select></label></div>
            {p.protocol === "pi-native" ? <div className="space-y-2"><p className="text-xs text-zinc-400">复用 Pi 的 auth.json / 环境变量和分类模型目录；无需重复保存 Key。</p><label className="block">Pi provider ID<input className={field} value={p.piProviderId ?? ""} onChange={e => updateProvider(p.id, { piProviderId: e.target.value })}/></label><button className={button} onClick={() => send("native_models")}>加载 Pi 分类模型目录</button></div> : <><label className="block">完整调用地址<input className={field} type="url" value={p.endpoint} onChange={e => updateProvider(p.id, { endpoint: e.target.value })}/></label>
            <p className="text-xs text-zinc-400">凭据将发送到该地址；修改地址时请核对目标域名。</p>
            <label className="block">鉴权<select className={field} value={p.auth.mode} onChange={e => updateProvider(p.id, { auth: { mode: e.target.value as Provider['auth']['mode'] } })}><option value="none">无鉴权（本地服务）</option><option value="env">环境变量</option><option value="secret">API Key</option></select></label>
            {p.auth.mode === 'env' && <label className="block">Shell 环境变量名<input className={field} value={p.auth.envVar ?? ''} onChange={e => updateProvider(p.id, { auth: { mode: 'env', envVar: e.target.value } })}/></label>}
            {p.auth.mode === 'secret' && <label className="block">{p.auth.credentialId ? 'API Key 已保存，留空保持，填写替换' : 'API Key'}<input type="password" autoComplete="new-password" className={field} value={p.apiKey ?? ''} onChange={e => updateProvider(p.id, { apiKey: e.target.value })}/></label>}
            </>}
            <label className="block">超时（毫秒）<input type="number" min={1000} max={120000} className={field} value={p.timeoutMs} onChange={e => updateProvider(p.id, { timeoutMs: Number(e.target.value) })}/></label>
            {config.models.filter(m => m.providerId === p.id).map(m => <div key={m.id} className="border-l-2 pl-3 space-y-2"><label className="block">模型显示名<input className={field} value={m.name} onChange={e => updateModel(m.id, { name: e.target.value })}/></label><label className="block">远端模型 ID（自部署可留空）<input className={field} value={m.remoteModel ?? ''} onChange={e => updateModel(m.id, { remoteModel: e.target.value })}/></label>{p.protocol === "pi-native" && <label className="block">Pi 分类模型<select className={field} value={m.remoteModel ?? ""} onChange={e => updateModel(m.id, { remoteModel: e.target.value })}><option value="">请选择或手动输入 ID</option>{nativeModels.filter(n => n.provider === p.piProviderId).map(n => <option key={n.id} value={n.id}>{n.name} · {n.id}</option>)}</select></label>}
              <div className="flex gap-3">{(['choice', 'score', 'noul'] as QType[]).map(t => <label key={t}><input type="checkbox" checked={m.questionTypes.includes(t)} onChange={e => updateModel(m.id, { questionTypes: e.target.checked ? [...m.questionTypes, t] : m.questionTypes.filter(x => x !== t) })}/> {t}</label>)}</div>
              <label className="block">置信度语义<select className={field} value={m.confidenceSemantics} onChange={e => updateModel(m.id, { confidenceSemantics: e.target.value as Model['confidenceSemantics'] })}><option value="unknown">未知</option><option value="vendor-defined">供应商定义（Jev / Kev）</option><option value="normalized-entropy">归一化熵（Laya）</option><option value="max-probability">最大选项概率</option></select></label>
              <div className="grid grid-cols-2 gap-2">{(['maxQuestions', 'maxOptions'] as const).map(key => <label key={key}>{key === 'maxQuestions' ? '最大问题数' : '最大选项数'}<input className={field} type="number" min={1} max={255} value={m[key] ?? ''} onChange={e => updateModel(m.id, { [key]: e.target.value ? Number(e.target.value) : undefined })}/></label>)}</div>
              <p className="text-xs text-zinc-400">{m.lastTest ? `${m.lastTest.ok ? "最近测试通过" : "最近测试失败"} · ${m.lastTest.at} · revision ${m.lastTest.revision}${m.lastTest.revision !== config.revision ? "（配置已更新，需重测）" : ""}` : "尚未测试"}</p><div className="flex gap-2"><button className={button} disabled={dirty || pending || !config.enabled} onClick={() => { setTestModel(m.id); setResult(null); send('test', { modelId: m.id }) }}>测试模型（可能计费）</button><button className={button} onClick={() => { if (window.confirm('删除前请解除该模型的全局和项目选择。继续从草稿删除？')) mark({ ...config, models: config.models.filter(x => x.id !== m.id) }) }}>删除模型</button></div>
            </div>)}
            <div className="flex gap-2"><button className={button} onClick={() => mark({ ...config, models: [...config.models, { id: crypto.randomUUID(), providerId: p.id, name: '新决策模型', questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'unknown' }] })}>＋ 添加模型</button><button className={button} onClick={() => { if (window.confirm('删除服务商及所有关联模型？请先解除使用中的选择。')) mark({ ...config, providers: config.providers.filter(x => x.id !== p.id), models: config.models.filter(m => m.providerId !== p.id) }) }}>删除服务商</button></div>
          </fieldset>)}
          {error && <p role="alert" className="text-red-400">{error}</p>}
          {result && <div className="space-y-2 border rounded p-3"><h3>最近测试通过 · {config.models.find(m => m.id === testModel)?.name}</h3><DecisionResult result={result}/></div>}
        </div>
        <footer className="p-4 border-t flex gap-3"><button className={button} disabled={pending || !dirty} onClick={() => send('save', { config })}>{pending ? '处理中…' : '保存决策配置'}</button><button className={button} disabled={pending} onClick={() => { if (!dirty || window.confirm('刷新并放弃草稿？')) { dirtyRef.current = false; setDirty(false); send('list') } }}>刷新</button><span className="text-xs self-center">{dirty ? '未保存' : `已保存 · revision ${config.revision}`}</span></footer>
      </section>
    </div>}
  </>
}
