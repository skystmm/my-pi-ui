import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { getAgentDir } from '../../paths.js'
import { evaluateDecision, validateRequest } from '../client.js'
import { decisionStore } from '../store.js'
import { DecisionError, type Resolved } from '../types.js'
import { acquireEvaluation } from '../capacity.js'
import { smokeSuite, suite, suiteHash, validateSuite } from './suites.js'
import { scoreRows } from './metrics.js'
import type { EvalInput, EvalReport, EvalRow, EvalRun, RunSpec } from './types.js'
const METRIC_VERSION = 's1-metrics-v1'
const ADAPTER_VERSION = 'systemone-v2-pi104'
function atomic(path: string, value: unknown) { const temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(temp, path) }
function markdown(report: Omit<EvalReport, 'markdown'>) {
  const fmt = (n?: number) => n === undefined ? 'N/A' : n.toFixed(4)
  return `# System One evaluation ${report.run.id}\n\nStatus: ${report.run.status} · suite: ${report.run.suiteId}\n\nSmoke tests verify integration only; they do not establish model quality or token savings.\n\nCompleted: ${report.run.completed}/${report.run.total}; errors: ${report.run.errors}; unsupported: ${report.run.skipped}.\n\n| Model | Type | Group | Valid/attempted | Accuracy | Attempted accuracy | Brier | ECE | MAE | p50/p95 ms |\n|---|---|---|---|---|---|---|---|---|---|\n${report.metrics.map(m => `| ${m.modelId} | ${m.type} | ${m.group} | ${m.valid}/${m.attempted} | ${fmt(m.accuracy)} | ${fmt(m.attemptedAccuracy)} | ${fmt(m.brier)} | ${fmt(m.ece)} | ${fmt(m.mae)} | ${fmt(m.p50Ms)}/${fmt(m.p95Ms)} |`).join('\n')}\n\nMetrics: ${METRIC_VERSION}; suite SHA256: ${report.run.suiteHash}.\n\nWorkflow token savings: not_run. Confidence uses probabilities, not vendor confidence. No retries.\n`
}
export class EvalService {
  private dir: string
  private resolve: (id: string) => Resolved
  private evaluate: typeof evaluateDecision
  private deadlineMs: number
  private active?: { run: EvalRun; owner: string; controller: AbortController; promise: Promise<EvalReport> }
  private volatileReports = new Map<string, EvalReport>()
  private listeners = new Set<(run: EvalRun) => void>()
  constructor(options: { dir?: string; resolve?: (id: string) => Resolved; evaluate?: typeof evaluateDecision; deadlineMs?: number } = {}) {
    this.dir = options.dir ?? join(getAgentDir(), 'pi-ui', 'evals'); this.resolve = options.resolve ?? (id => decisionStore.resolveModel(id)); this.evaluate = options.evaluate ?? evaluateDecision; this.deadlineMs = options.deadlineMs ?? 15 * 60 * 1000
    // Only persisted runs are recovered; no automatic network requests or retries.
    if (existsSync(this.dir)) for (const id of readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue
      try {
        const run = this.get(id)
        if (run.status === 'running' && !this.hostAlive(id)) {
          run.status = 'interrupted'; run.finishedAt = new Date().toISOString()
          this.persistReport(run)
        }
      } catch { /* A damaged run must not prevent other runs loading. */ }
    }
  }
  private hostAlive(id: string) {
    const path = join(this.path(id), 'lease.json')
    if (!existsSync(path)) return false
    const { pid } = JSON.parse(readFileSync(path, 'utf8'))
    if (!Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
  }
  onProgress(listener: (run: EvalRun) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private path(id: string) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new DecisionError('invalid_run_id'); return join(this.dir, id) }
  get(id: string): EvalRun { this.path(id); const fallback = this.volatileReports.get(id); if (fallback) return structuredClone(fallback.run); try { return JSON.parse(readFileSync(join(this.path(id), 'manifest.json'), 'utf8')) } catch (e) { if (e instanceof DecisionError) throw e; throw new DecisionError('run_not_found') } }
  list() { return existsSync(this.dir) ? readdirSync(this.dir).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => { try { return [this.get(id)] } catch { return [] } }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100) : [] }
  start(spec: RunSpec, owner: string): EvalRun {
    if (!spec || !Array.isArray(spec.modelIds) || !spec.modelIds.length || spec.modelIds.length > 8 || new Set(spec.modelIds).size !== spec.modelIds.length || spec.modelIds.some(id => typeof id !== 'string')) throw new DecisionError('invalid_run')
    const repeats = spec.repeats ?? 1
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new DecisionError('invalid_run')
    const dataset = suite(spec.suiteId); validateSuite(spec.suiteId)
    if (dataset.cases.length * repeats * spec.modelIds.length > 200) throw new DecisionError('invalid_run')
    if (this.active) throw new DecisionError('eval_busy')
    const configs = spec.modelIds.map(id => structuredClone(this.resolve(id)))
    for (const config of configs) for (const item of dataset.cases) if (config.model.questionTypes.includes(item.expected.type)) validateRequest(config, item.request)
    const run: EvalRun = { id: randomUUID(), suiteId: dataset.id, suiteHash: suiteHash(dataset), metricVersion: METRIC_VERSION, adapterVersion: ADAPTER_VERSION, startedAt: new Date().toISOString(), status: 'running', total: dataset.cases.length * repeats * configs.length, completed: 0, errors: 0, skipped: 0, repeats, promotionEligible: false, models: configs.map(c => ({ id: c.model.id, name: c.model.name, providerId: c.provider.id, protocol: c.provider.protocol, remoteModel: c.model.remoteModel, revision: c.revision, confidenceSemantics: c.model.confidenceSemantics, endpointOrigin: c.provider.protocol === "pi-native" ? `pi:${c.provider.piProviderId}` : new URL(c.provider.endpoint).origin, timeoutMs: c.provider.timeoutMs, questionTypes: c.model.questionTypes, maxQuestions: c.model.maxQuestions, maxOptions: c.model.maxOptions })) }
    const path = this.path(run.id); mkdirSync(path, { recursive: true, mode: 0o700 }); atomic(join(path, 'lease.json'), { pid: process.pid }); atomic(join(path, 'manifest.json'), run); atomic(join(path, 'cases.json'), dataset)
    writeFileSync(join(path, 'events.jsonl'), '', { mode: 0o600 })
    const controller = new AbortController()
    const promise = Promise.resolve().then(() => this.execute(run, configs, controller))
    this.active = { run, controller, owner, promise }; this.emit(run)
    return structuredClone(run)
  }
  cancel(id: string) { const run = this.get(id); if (run.status === 'running') { if (this.active?.run.id === id) this.active.controller.abort(); else atomic(join(this.path(id), 'cancel.json'), { requestedAt: new Date().toISOString() }) } return run }
  cancelOwner(owner: string) { if (this.active?.owner === owner) this.active.controller.abort() }
  async shutdown() { const active = this.active; if (active) { active.controller.abort(); await active.promise } }
  async settled(id: string) { if (this.active?.run.id === id) return this.active.promise; return this.report(id) }
  private emit(run: EvalRun) { for (const listener of this.listeners) { try { listener(structuredClone(run)) } catch { /* Observers cannot fail the job. */ } } }
  private rows(id: string): EvalRow[] { return readFileSync(join(this.path(id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }) }
  private buildReport(run: EvalRun): EvalReport {
    const rows = this.rows(run.id), dataset = JSON.parse(readFileSync(join(this.path(run.id), 'cases.json'), 'utf8'))
    const errors: Record<string, number> = {}; rows.filter(r => r.status === 'error').forEach(r => { errors[r.code ?? 'unknown'] = (errors[r.code ?? 'unknown'] ?? 0) + 1 })
    const base = { run: structuredClone(run), metrics: scoreRows(dataset, rows), errors, workflow: { status: 'not_run' as const } }
    const report = { ...base, markdown: markdown(base) }
    return report
  }
  private persistReport(run: EvalRun): EvalReport {
    const report = this.buildReport(run)
    atomic(join(this.path(run.id), 'report.json'), report); atomic(join(this.path(run.id), 'manifest.json'), run)
    writeFileSync(join(this.path(run.id), 'report.md'), report.markdown, { mode: 0o600 }); return report
  }
  report(id: string): EvalReport { const run = this.get(id); const fallback = this.volatileReports.get(id); return fallback ? structuredClone(fallback) : this.buildReport(run) }
  compare(id: string, baselineId: string) {
    const current = this.report(id), baseline = this.report(baselineId)
    const compatible = ['suiteHash', 'metricVersion', 'adapterVersion', 'repeats'].every(key => current.run[key as keyof EvalRun] === baseline.run[key as keyof EvalRun]) && current.run.status === 'completed' && baseline.run.status === 'completed'
    return { compatible, reason: compatible ? 'descriptive_only_no_significance_test' : 'incompatible_or_incomplete_runs', current, baseline }
  }
  dispatch(input: EvalInput, owner: string): unknown {
    if (!input || typeof input !== 'object') throw new DecisionError('invalid_request')
    switch (input.action) {
      case 'suites': return [{ ...validateSuite(smokeSuite.id), types: ['choice', 'score', 'noul'], languages: ['en', 'zh'] }]
      case 'validate': return validateSuite(input.suiteId ?? smokeSuite.id)
      case 'run': return this.start(input.spec!, owner)
      case 'list': return this.list()
      case 'status': return this.get(input.runId!)
      case 'cancel': return this.cancel(input.runId!)
      case 'report': return this.report(input.runId!)
      case 'compare': return this.compare(input.runId!, input.baselineId!)
      default: throw new DecisionError('invalid_request')
    }
  }
  private async execute(run: EvalRun, configs: Resolved[], controller: AbortController): Promise<EvalReport> {
    const deadline = AbortSignal.timeout(this.deadlineMs), signal = AbortSignal.any([controller.signal, deadline])
    const cancellation = setInterval(() => { if (existsSync(join(this.path(run.id), 'cancel.json'))) controller.abort() }, 250)
    const startedModels = new Set<string>()
    try {
      outer: for (const config of configs) for (let repeat = 0; repeat < run.repeats; repeat++) for (const item of suite(run.suiteId).cases) {
        if (signal.aborted) break outer
        const row: EvalRow = { modelId: config.model.id, caseId: item.id, repeat, status: 'unsupported' }
        if (!config.model.questionTypes.includes(item.expected.type)) { run.skipped++ } else {
          let release: (() => void) | undefined
          let started: number | undefined
          try { release = await acquireEvaluation(config.provider.id, signal); started = performance.now(); row.firstCall = !startedModels.has(config.model.id); startedModels.add(config.model.id); row.result = await this.evaluate(config, item.request, signal); row.status = 'ok' }
          catch (e) { if (signal.aborted && started === undefined) break outer; row.status = 'error'; row.code = signal.aborted ? (controller.signal.aborted ? 'cancelled' : 'deadline') : e instanceof DecisionError ? e.code : 'upstream_error'; run.errors++ }
          finally { if (started !== undefined) row.latencyMs = performance.now() - started; release?.() }
        }
        appendFileSync(join(this.path(run.id), 'events.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 }); run.completed++
        atomic(join(this.path(run.id), 'manifest.json'), run); this.emit(run)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      run.status = controller.signal.aborted ? 'cancelled' : deadline.aborted ? 'deadline' : 'completed'
    } catch { run.status = 'failed' }
    finally { clearInterval(cancellation); run.finishedAt = new Date().toISOString() }
    try { return this.persistReport(run) }
    catch {
      // A failed journal must not produce scores or an unhandled rejection.
      run.status = 'failed'
      const base = { run: structuredClone(run), metrics: [], errors: { storage_error: 1 }, workflow: { status: 'not_run' as const } }
      const report = { ...base, markdown: markdown(base) + '\nReport could not be persisted: storage_error.\n' }
      this.volatileReports.set(run.id, report)
      if (this.volatileReports.size > 100) this.volatileReports.delete(this.volatileReports.keys().next().value!)
      return report
    } finally { this.active = undefined; this.emit(run) }
  }
}
export const evalService = new EvalService()
