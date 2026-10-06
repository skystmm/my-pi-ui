// GENERATED — do not edit. Source: shell-service/system-one/eval/types.ts
// Regenerate with: npm run sync:protocol
import type { DecisionRequest, QType, Result } from '../types'
export type EvalCase = { id: string; sourceGroup: string; language: 'en' | 'zh'; tags: string[]; request: DecisionRequest; expected: { type: 'choice'; label: string } | { type: 'noul'; label: boolean } | { type: 'score'; label: number; tolerance: number } }
export type EvalSuite = { id: string; version: number; purpose: 'smoke'; cases: EvalCase[] }
export type RunSpec = { suiteId: string; modelIds: string[]; repeats?: number }
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed' | 'deadline'
export type EvalRun = { id: string; suiteId: string; suiteHash: string; metricVersion: string; adapterVersion: string; startedAt: string; finishedAt?: string; status: RunStatus; total: number; completed: number; skipped: number; errors: number; repeats: number; promotionEligible: boolean; models: { id: string; name: string; providerId: string; protocol: string; remoteModel?: string; revision: number; confidenceSemantics: string; endpointOrigin: string; timeoutMs: number; questionTypes: QType[]; maxQuestions?: number; maxOptions?: number }[] }
export type EvalRow = { modelId: string; caseId: string; repeat: number; status: 'ok' | 'error' | 'unsupported'; firstCall?: boolean; latencyMs?: number; code?: string; result?: Result }
export type EvalMetric = { modelId: string; type: QType; group: string; valid: number; attempted: number; unsupported: number; accuracy?: number; attemptedAccuracy?: number; macroF1?: number; precision?: number; recall?: number; f1?: number; brier?: number; ece?: number; mae?: number; toleranceAccuracy?: number; confusion?: Record<string, Record<string, number>>; p50Ms?: number; p95Ms?: number; firstCallMs?: number; warmP50Ms?: number; consistency?: number }
export type EvalReport = { run: EvalRun; metrics: EvalMetric[]; errors: Record<string, number>; workflow: { status: 'not_run' }; markdown: string }
export type EvalAction = 'suites' | 'validate' | 'run' | 'list' | 'status' | 'cancel' | 'report' | 'compare'
export type EvalInput = { action: EvalAction; spec?: RunSpec; runId?: string; baselineId?: string; suiteId?: string }
