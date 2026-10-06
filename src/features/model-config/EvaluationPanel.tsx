import { useEffect, useRef, useState } from 'react'
import { wsClient } from '../../lib/ws-client'
import type { Config } from '../../lib/system-one/types'
import type { EvalAction, EvalInput, EvalMetric, EvalReport, EvalRun } from '../../lib/system-one/eval/types'
const field = 'rounded border p-2 bg-[var(--bg)] border-[var(--border)]'
const button = 'rounded border px-3 py-2 text-sm disabled:opacity-40 border-[var(--border)]'
const fmt = (n?: number) => n === undefined ? 'N/A' : n.toFixed(3)
const errors: Record<string, string> = { disabled: '请先启用并保存决策配置。', missing_credential: '模型缺少凭据，请到决策配置补全。', eval_busy: '已有测评在运行，请等待或取消。', invalid_run: '运行参数超出限制：最多 8 个模型、10 次重复、200 次调用。', not_configured: '模型已不存在，请刷新配置。', input_too_large: '模型能力限制无法容纳测试用例。' }
function Metrics({ metrics }: { metrics: EvalMetric[] }) {
  return <div className="overflow-auto"><table className="text-xs w-full whitespace-nowrap"><thead><tr>{['模型 / 类型 / 分组', '有效/尝试', '正确率', '含失败正确率', 'F1', 'Brier', 'ECE', 'MAE', '容差命中', 'p50/p95 ms', '重复一致性'].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead><tbody>{metrics.map(m => <tr key={`${m.modelId}:${m.type}:${m.group}`} className="border-t border-[var(--border)]"><td className="p-2">{m.modelId} / {m.type} / {m.group}</td><td>{m.valid}/{m.attempted}</td><td>{fmt(m.accuracy)}</td><td>{fmt(m.attemptedAccuracy)}</td><td>{fmt(m.f1 ?? m.macroF1)}</td><td>{fmt(m.brier)}</td><td>{fmt(m.ece)}</td><td>{fmt(m.mae)}</td><td>{fmt(m.toleranceAccuracy)}</td><td>{fmt(m.p50Ms)}/{fmt(m.p95Ms)}</td><td>{fmt(m.consistency)}</td></tr>)}</tbody></table></div>
}
export function EvaluationPanel({ config, dirty, onClose }: { config: Config; dirty: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null)
  const [models, setModels] = useState<string[]>([]), [repeats, setRepeats] = useState(1)
  const [runs, setRuns] = useState<EvalRun[]>([]), [report, setReport] = useState<EvalReport | null>(null)
  const [baseline, setBaseline] = useState(''), [comparison, setComparison] = useState<{ compatible: boolean; reason: string; current: EvalReport; baseline: EvalReport } | null>(null)
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [ready, setReady] = useState(wsClient.ready)
  const requests = useRef(new Map<string, { action: EvalAction; timer: number }>())
  const close = useRef(onClose); close.current = onClose
  function send(input: EvalInput) {
    if (!wsClient.ready) { setError('Shell Service 未连接。'); return }
    const requestId = crypto.randomUUID(); setPending(true); setError('')
    const timer = window.setTimeout(() => { requests.current.delete(requestId); setPending(requests.current.size > 0); setError('请求超时，请刷新运行状态。') }, 10000)
    requests.current.set(requestId, { action: input.action, timer }); wsClient.send({ t: 'eval_command', requestId, input })
  }
  useEffect(() => {
    let previous = false
    const off = wsClient.on(ev => {
      if (ev.t === 'eval_progress') { setRuns(old => [ev.run, ...old.filter(r => r.id !== ev.run.id)].slice(0, 100)); return }
      if (ev.t !== 'eval_result') return
      const request = requests.current.get(ev.requestId); if (!request) return
      clearTimeout(request.timer); requests.current.delete(ev.requestId); setPending(requests.current.size > 0)
      if (!ev.ok) { setError(errors[ev.code ?? ''] ?? `测评失败：${ev.code}`); return }
      if (request.action === 'list') setRuns(ev.result as EvalRun[])
      if (request.action === 'run' || request.action === 'cancel') { const run = ev.result as EvalRun; setRuns(old => [run, ...old.filter(r => r.id !== run.id)]); if (request.action === 'run') { setReport(null); setComparison(null) } }
      if (request.action === 'report') { setReport(ev.result as EvalReport); setComparison(null) }
      if (request.action === 'compare') setComparison(ev.result as typeof comparison)
    })
    const timer = window.setInterval(() => { const connected = wsClient.ready; setReady(connected); if (connected && !previous) send({ action: 'list' }); previous = connected }, 1000)
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); close.current() }
      if (event.key === 'Tab') { const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') ?? []); const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
    }
    window.addEventListener('keydown', handler, true)
    return () => { off(); clearInterval(timer); requests.current.forEach(r => clearTimeout(r.timer)); requests.current.clear(); window.removeEventListener('keydown', handler, true); previousFocus?.focus() }
  }, [])
  const total = models.length * 6 * repeats, running = runs.some(r => r.status === 'running')
  const valid = models.length > 0 && models.length <= 8 && Number.isInteger(repeats) && repeats >= 1 && repeats <= 10 && total <= 200
  const exportReport = (format: 'json' | 'md') => { if (!report) return; const blob = new Blob([format === 'json' ? JSON.stringify(report, null, 2) : report.markdown], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `s1-eval-${report.run.id}.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return <div className="fixed inset-0 z-[60] bg-black/50 flex justify-end" onClick={e => { if (e.target === e.currentTarget) onClose() }}><section ref={dialog} role="dialog" aria-modal="true" aria-label="System One 模型测评" className="w-[1000px] max-w-full h-full bg-[var(--bg-card)] text-[var(--fg)] flex flex-col shadow-xl">
    <header className="p-4 border-b border-[var(--border)] flex justify-between"><h2>System One 模型测评</h2><button aria-label="关闭模型测评" onClick={onClose}>关闭</button></header>
    <div className="p-4 overflow-auto space-y-5 flex-1">
      <p className="text-sm">内置 smoke-v1：中英文 × choice / noul / score，6 个固定标签样例。仅验证接入与计算链路；当前结果不能证明通用模型质量或 LLM token 节省。</p>
      {dirty && <p role="alert" className="text-amber-400">决策配置有未保存内容，请先保存再测评。</p>}
      <fieldset className="border rounded p-3 space-y-2" disabled={dirty || pending || running || !ready}><legend>选择已保存的模型</legend>{config.models.map(m => <label key={m.id} className="flex gap-2"><input type="checkbox" checked={models.includes(m.id)} onChange={e => setModels(old => e.target.checked ? [...old, m.id] : old.filter(id => id !== m.id))}/>{m.name} · {config.providers.find(p => p.id === m.providerId)?.name} · {m.id}</label>)}<label className="flex gap-2 items-center">每个样例重复次数<input aria-label="测评重复次数" type="number" min={1} max={10} value={repeats} className={field} onChange={e => setRepeats(Number(e.target.value))}/></label></fieldset>
      <p className="text-xs">最多 {total} 次 HTTP 调用，未支持的题型跳过；顺序执行、不自动重试，15 分钟总时限。云服务可能计费。模型配置在启动时冻结，项目默认模型保持原选择。</p>
      <div className="flex gap-3"><button className={button} disabled={dirty || pending || running || !ready || !config.enabled || !valid} onClick={() => send({ action: 'run', spec: { suiteId: 'smoke-v1', modelIds: models, repeats } })}>开始测评（{total} 次，可能计费）</button><button className={button} disabled={pending || !ready} onClick={() => send({ action: 'list' })}>刷新运行记录</button></div>
      {!config.enabled && <p className="text-amber-400">请在决策配置中启用模型。</p>}{!ready && <p role="alert">Shell Service 未连接；重连后会刷新运行记录。</p>}{error && <p role="alert" className="text-red-400">{error}</p>}
      <div className="space-y-2"><h3>运行记录</h3>{runs.length === 0 && <p className="text-xs">尚无测评记录</p>}{runs.map(run => <div key={run.id} className="border rounded p-3 space-y-2 text-xs"><p>{run.startedAt} · {run.status} · {run.models.map(m => m.name).join(', ')}</p><p className="break-all">{run.id} · {run.completed}/{run.total} · 失败 {run.errors} · 不支持 {run.skipped}</p><progress className="w-full" max={run.total} value={run.completed}/><div className="flex gap-2"><button className={button} disabled={pending || !ready} onClick={() => send({ action: 'report', runId: run.id })}>查看报告</button>{run.status === 'running' && <button className={button} disabled={pending || !ready} onClick={() => send({ action: 'cancel', runId: run.id })}>取消测评</button>}</div></div>)}</div>
      {report && <section className="space-y-3"><h3>报告 · {report.run.status}</h3><p className="text-xs break-all">数据集 SHA256：{report.run.suiteHash} · {report.run.metricVersion}</p><p className="text-xs">Brier 越小越好：choice 范围 0–2，noul 范围 0–1。ECE 使用答案概率；score 不计算 ECE。空指标显示 N/A。延迟包含失败调用。</p><Metrics metrics={report.metrics.filter(m => m.group === 'all')}/><details><summary>语言与标签分组</summary><Metrics metrics={report.metrics.filter(m => m.group !== 'all')}/></details><details><summary>错误与模型快照</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({ errors: report.errors, models: report.run.models, workflow: report.workflow }, null, 2)}</pre></details><div className="flex gap-2"><button className={button} onClick={() => exportReport('json')}>导出 JSON</button><button className={button} onClick={() => exportReport('md')}>导出 Markdown</button></div><label className="flex gap-2">比较基线<select aria-label="测评比较基线" className={field} value={baseline} onChange={e => setBaseline(e.target.value)}><option value="">选择运行</option>{runs.filter(r => r.id !== report.run.id).map(r => <option key={r.id} value={r.id}>{r.startedAt} · {r.models.map(m => m.name).join(', ')} · {r.status}</option>)}</select></label><button className={button} disabled={!baseline || pending || !ready} onClick={() => send({ action: 'compare', runId: report.run.id, baselineId: baseline })}>比较报告</button></section>}
      {comparison && <section className="space-y-3"><h3>{comparison.compatible ? '可比较 · 仅描述性结果，无显著性检验' : '不可比较：数据集、指标版本、重复次数不同或运行未完成'}</h3>{comparison.compatible && <><p>当前运行</p><Metrics metrics={comparison.current.metrics.filter(m => m.group === 'all')}/><p>基线运行</p><Metrics metrics={comparison.baseline.metrics.filter(m => m.group === 'all')}/></>}</section>}
    </div><footer className="p-4 border-t text-xs">关闭此面板后 Shell 继续执行；可重新打开查询。Pi 命令启动的运行随该 Pi 会话关闭取消。工作流 token 收益实验：尚未执行。</footer>
  </section></div>
}
