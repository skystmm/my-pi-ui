import type { Result } from '../../lib/system-one/types'

// Session details can come from older extensions or hand-edited JSONL files.
export function asDecisionResult(value: unknown): Result | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Result
  if (typeof r.actualModel !== 'string' || !r.answers || typeof r.answers !== 'object' || Array.isArray(r.answers)) return null
  if (Object.values(r.answers).some(a => !a || typeof a !== 'object' || Array.isArray(a))) return null
  return r
}

export function DecisionResult({ result }: { result: Result }) {
  return <div className="space-y-2 text-xs">
    <p>实际模型 {result.actualModel} · {result.latencyMs} ms · revision {result.revision} · confidence: {result.confidenceSemantics}</p>
    {Object.entries(result.answers).map(([id, a]) => <div key={id}>
      <strong>{id}</strong> · {String(a.choice ?? a.score ?? a.noul)}
      {typeof a.confidence === 'number' && <span> · confidence {a.confidence}</span>}
      {a.probabilities && typeof a.probabilities === 'object' ? Object.entries(a.probabilities).map(([k, v]) => <div key={k} className="flex gap-2 items-center">
        <span className="w-24 truncate">{k}</span><meter min={0} max={1} value={Number(v)} className="flex-1"/>{(Number(v) * 100).toFixed(1)}%
      </div>) : null}
    </div>)}
    <details><summary>结构化结果（含 usage）</summary><pre className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre></details>
  </div>
}
