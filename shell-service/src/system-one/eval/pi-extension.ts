import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEvalCommand } from './command-parser.js'
import type { EvalInput, EvalReport, EvalRun } from './types.js'
type Context = { ui: { notify: (message: string, level?: string) => void; setStatus: (key: string, text?: string) => void } }
type Pi = { registerEntryRenderer?: (name: string, renderer: (entry: { data?: { runId?: string; status?: string } }) => { render: (width: number) => string[]; invalidate: () => void }) => void; registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: Context) => Promise<void> }) => void; appendEntry: (type: string, data: unknown) => void; on: (event: string, handler: () => Promise<void>) => void }
export default function systemOneEval(pi: Pi) {
  let companion: ChildProcess | undefined, connection: Promise<{ url: string; token: string }> | undefined
  let polling: ReturnType<typeof setInterval> | undefined, ownedRun: string | undefined
  let busy = false, shuttingDown = false
  pi.registerEntryRenderer?.('s1-eval', entry => ({ render: width => [`System One evaluation: ${entry.data?.status ?? 'unknown'} / ${entry.data?.runId ?? ''}`.slice(0, Math.max(0, width))], invalidate() {} }))
  async function connect() {
    if (process.env.PI_UI_EVAL_URL && process.env.PI_UI_EVAL_TOKEN) return { url: process.env.PI_UI_EVAL_URL, token: process.env.PI_UI_EVAL_TOKEN }
    if (!connection) connection = new Promise((resolve, reject) => {
      const entry = fileURLToPath(new URL('./companion.js', import.meta.url))
      if (!existsSync(entry)) { reject(new Error('Build first: npm run build:shell')); return }
      const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env }); companion = child
      let buffer = '', settled = false
      const timeout = setTimeout(() => { reject(new Error('companion_timeout')); child.kill() }, 10000)
      child.stdout!.on('data', data => { buffer += data.toString(); if (buffer.length > 4096) { reject(new Error('invalid_companion')); child.kill() } else if (!settled && buffer.includes('\n')) { settled = true; clearTimeout(timeout); try { resolve(JSON.parse(buffer.split('\n')[0])) } catch { reject(new Error('invalid_companion')) } } })
      child.stderr!.resume() // Never expose credentials or raw upstream errors.
      child.on('error', () => { clearTimeout(timeout); reject(new Error('companion_unavailable')) })
      child.on('exit', () => { clearTimeout(timeout); if (!settled) reject(new Error('companion_unavailable')); connection = undefined; companion = undefined })
    })
    try { return await connection } catch (error) { connection = undefined; throw error }
  }
  async function call(input: EvalInput): Promise<any> {
    const host = await connect(), response = await fetch(host.url, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) })
    const value = await response.json() as any
    if (!response.ok) throw new Error(value.code ?? 'eval_unavailable')
    return value
  }
  function summary(run: EvalRun) { return `${run.id} · ${run.status} · ${run.completed}/${run.total} · errors ${run.errors} · skipped ${run.skipped}` }
  function watch(run: EvalRun, ctx: Context) {
    clearInterval(polling); ownedRun = run.id
    polling = setInterval(async () => {
      if (busy) return; busy = true
      try {
        const current = await call({ action: 'status', runId: run.id }) as EvalRun
        if (ownedRun !== run.id || shuttingDown) return
        ctx.ui.setStatus('s1-eval', summary(current))
        if (current.status !== 'running') { clearInterval(polling); polling = undefined; ownedRun = undefined; ctx.ui.notify(`System One: ${summary(current)}`); pi.appendEntry('s1-eval', { runId: run.id, status: current.status, suiteId: current.suiteId }); ctx.ui.setStatus('s1-eval', undefined) }
      } catch { clearInterval(polling); polling = undefined; ctx.ui.notify('测评状态连接失败，请用 /s1-eval status 查询。', 'error') }
      finally { busy = false }
    }, 1000)
  }
  pi.registerCommand('s1-eval', { description: 'System One 测评：suites | validate | run --models id,id [--suite smoke-v1] [--repeats 1] | list | status/cancel/report <runId> | compare <runId> --baseline <runId>', async handler(args, ctx) {
    try {
      const input = parseEvalCommand(args), value = await call(input)
      if (input.action === 'run') { ctx.ui.notify(`已启动（每模型 6 × repeats 次调用，可能计费）：${summary(value)}`); watch(value, ctx) }
      else if (input.action === 'report') { const report = value as EvalReport; ctx.ui.notify(`${summary(report.run)}\n${report.metrics.filter(m => m.group === 'all').map(m => `${m.modelId} ${m.type}: accuracy=${m.accuracy ?? 'N/A'}, MAE=${m.mae ?? 'N/A'}, Brier=${m.brier ?? 'N/A'}`).join('\n')}\n完整报告：pi-ui 测评面板或 agent-dir/pi-ui/evals/${report.run.id}/report.md`); pi.appendEntry('s1-eval', { runId: report.run.id, status: report.run.status, suiteId: report.run.suiteId }) }
      else if (input.action === 'compare') ctx.ui.notify(`${value.compatible ? '可比较（仅描述性，无显著性检验）' : '不可比较'}：${value.current.run.id} / ${value.baseline.run.id}。完整比较请打开 pi-ui 测评面板。`)
      else ctx.ui.notify(JSON.stringify(value, null, 2))
    } catch (e) { ctx.ui.notify(`System One evaluation: ${e instanceof Error ? e.message : 'unavailable'}`, 'error') }
  } })
  pi.on('session_shutdown', async () => { shuttingDown = true; clearInterval(polling); if (ownedRun) { try { await call({ action: 'cancel', runId: ownedRun }) } catch { /* Revoking host grant also cancels owned jobs. */ } } ownedRun = undefined; if (companion) { const child = companion; await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 2000); child.once('exit', () => { clearTimeout(timer); resolve() }); child.stdin?.end() }) } companion = undefined; connection = undefined })
}
