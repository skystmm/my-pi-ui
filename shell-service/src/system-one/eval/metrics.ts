import type { EvalMetric, EvalRow, EvalSuite } from './types.js'
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined
const quantile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : undefined
export function scoreRows(suite: EvalSuite, rows: EvalRow[]): EvalMetric[] {
  const metrics: EvalMetric[] = []
  for (const modelId of new Set(rows.map(r => r.modelId))) for (const type of ['choice', 'noul', 'score'] as const) {
    const cases = suite.cases.filter(c => c.expected.type === type)
    for (const group of ['all', ...new Set(cases.map(c => `language:${c.language}`)), ...new Set(cases.flatMap(c => c.tags.map(t => `tag:${t}`)))]) {
      const selected = cases.filter(c => group === 'all' || group === `language:${c.language}` || c.tags.some(t => group === `tag:${t}`))
      const byId = new Map(selected.map(c => [c.id, c]))
      const subset = rows.filter(r => r.modelId === modelId && byId.has(r.caseId))
      const valid = subset.filter(r => r.status === 'ok')
      const attempted = subset.filter(r => r.status !== 'unsupported').length
      const metric: EvalMetric = { modelId, type, group, valid: valid.length, attempted, unsupported: subset.length - attempted }
      const labels = type === 'noul' ? ['false', 'true'] : type === 'choice' ? [...new Set(selected.flatMap(c => Object.keys(c.request.questions.decision.criteria ?? {})))] : []
      const confusion = Object.fromEntries(labels.map(l => [l, Object.fromEntries(labels.map(p => [p, 0]))]))
      const correct: number[] = [], brier: number[] = [], residual: number[] = [], tolerances: number[] = [], calibration: { confidence: number; correct: number }[] = []
      const predictions = new Map<string, string[]>()
      for (const row of valid) {
        const item = byId.get(row.caseId)!, expected = item.expected, answer = row.result!.answers.decision
        const prediction = expected.type === 'choice' ? String(answer.choice) : expected.type === 'noul' ? String(Number(answer.noul) >= .5) : String(answer.score)
        const history = predictions.get(item.id) ?? []; history.push(prediction); predictions.set(item.id, history)
        if (expected.type === 'score') { residual.push(Math.abs(Number(answer.score) - expected.label)); tolerances.push(Math.abs(Number(answer.score) - expected.label) <= expected.tolerance ? 1 : 0); continue }
        const truth = String(expected.label), hit = prediction === truth ? 1 : 0
        correct.push(hit); confusion[truth][prediction]++
        if (expected.type === 'choice') {
          const probabilities = answer.probabilities as Record<string, number>
          brier.push(Object.entries(probabilities).reduce((sum, [label, p]) => sum + (p - (label === truth ? 1 : 0)) ** 2, 0))
          calibration.push({ confidence: Math.max(...Object.values(probabilities)), correct: hit })
        } else {
          const p = Number(answer.noul); brier.push((p - Number(expected.label)) ** 2); calibration.push({ confidence: Math.max(p, 1 - p), correct: hit })
        }
      }
      if (correct.length) {
        metric.accuracy = mean(correct); metric.brier = mean(brier); metric.confusion = confusion
        let ece = 0
        for (let bin = 0; bin < 10; bin++) { const bucket = calibration.filter(c => Math.min(9, Math.floor(c.confidence * 10)) === bin); if (bucket.length) ece += bucket.length / calibration.length * Math.abs(mean(bucket.map(c => c.confidence))! - mean(bucket.map(c => c.correct))!) }
        metric.ece = ece
        const f1s = labels.map(label => {
          const tp = confusion[label][label], fp = labels.reduce((s, l) => s + (l !== label ? confusion[l][label] : 0), 0), fn = labels.reduce((s, l) => s + (l !== label ? confusion[label][l] : 0), 0)
          const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0, f1 = 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0
          if (type === 'noul' && label === 'true') Object.assign(metric, { precision, recall, f1 })
          return f1
        })
        if (type === 'choice') metric.macroF1 = mean(f1s)
      }
      if (attempted && type !== 'score') metric.attemptedAccuracy = correct.reduce((a, b) => a + b, 0) / attempted
      metric.mae = mean(residual); metric.toleranceAccuracy = mean(tolerances)
      const latencies = subset.filter(r => r.status !== 'unsupported' && r.latencyMs !== undefined).map(r => r.latencyMs!)
      metric.p50Ms = quantile(latencies, .5); metric.p95Ms = quantile(latencies, .95)
      metric.firstCallMs = subset.find(r => r.firstCall)?.latencyMs; metric.warmP50Ms = quantile(subset.filter(r => !r.firstCall && r.latencyMs !== undefined).map(r => r.latencyMs!), .5)
      const repeated = [...predictions.values()].filter(p => p.length > 1)
      metric.consistency = mean(repeated.map(p => Math.max(...[...new Set(p)].map(v => p.filter(x => x === v).length)) / p.length))
      metrics.push(metric)
    }
  }
  return metrics
}
