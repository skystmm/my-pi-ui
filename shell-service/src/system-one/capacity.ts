import { DecisionError } from './types.js'
// Interactive requests fail fast; evaluation waits and yields between cases.
const counts = new Map<string, number>()
export function acquire(providerId: string) {
  if ((counts.get(providerId) ?? 0) >= 2) throw new DecisionError('busy')
  counts.set(providerId, (counts.get(providerId) ?? 0) + 1)
  return () => counts.set(providerId, Math.max(0, (counts.get(providerId) ?? 0) - 1))
}
export async function acquireEvaluation(providerId: string, signal: AbortSignal) {
  for (;;) {
    signal.throwIfAborted()
    try { return acquire(providerId) } catch (error) { if (!(error instanceof DecisionError) || error.code !== 'busy') throw error }
    await new Promise<void>(resolve => { const timer = setTimeout(done, 25); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() } signal.addEventListener('abort', done, { once: true }) })
  }
}
