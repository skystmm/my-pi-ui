import type { Ctx } from '../commands/context.js'
import { canonCwd } from '../project-scanner.js'
import { decisionStore } from './store.js'
import { evaluateDecision } from './client.js'
import { DecisionError, type DecisionRequest } from './types.js'
import type { ShellCommand } from '../ws-protocol.js'
export async function decisionCommand(ctx: Ctx, cmd: Extract<ShellCommand, { t: 'decision_command' }>) {
  let testRevision: number | undefined
  try {
    if (!['list', 'save', 'select', 'test'].includes(cmd.action) || typeof cmd.requestId !== 'string') throw new DecisionError('invalid_request')
    const cwd = cmd.cwd ? canonCwd(cmd.cwd) : ''
    let result: unknown
    if (cmd.action === 'save') { if (!cmd.config) throw new DecisionError('invalid_config'); await decisionStore.save(cmd.config) }
    if (cmd.action === 'select') { if (!cwd) throw new DecisionError('cwd_not_found'); decisionStore.select(cwd, cmd.modelId); ctx.broadcast({ t: 'decision_selection', cwd, selection: decisionStore.selection(cwd) }) }
    if (cmd.action === 'test') {
      const config = decisionStore.resolveModel(cmd.modelId ?? '')
      testRevision = config.revision
      const questions: DecisionRequest['questions'] = {}
      for (const type of config.model.questionTypes) {
        if (type === 'choice') questions.task = { type, instructions: 'Which task is requested?', criteria: { review: 'Review existing code', build: 'Create new code' } }
        if (type === 'score') questions.relevance = { type, instructions: 'How relevant is this request to reviewing code?', criteria: ['Unrelated', 'Related', 'Direct request'] }
        if (type === 'noul') questions.review = { type, instructions: 'Does this ask for a code review?' }
      }
      result = await evaluateDecision(config, { state: 'Please review this existing code change.', questions })
      decisionStore.recordTest(config.model.id, config.revision, true)
    }
    ctx.send({ t: 'decision_result', requestId: cmd.requestId, ok: true, result, config: decisionStore.snapshot(), selection: decisionStore.selection(cwd) })
    if (cmd.action === 'save') ctx.broadcast({ t: 'decision_catalog', config: decisionStore.snapshot() })
  } catch (e) { if (cmd.action === 'test' && cmd.modelId && testRevision !== undefined) decisionStore.recordTest(cmd.modelId, testRevision, false, e instanceof DecisionError ? e.code : 'upstream_error'); ctx.send({ t: 'decision_result', requestId: cmd.requestId, ok: false, code: e instanceof DecisionError ? e.code : 'invalid_config', config: cmd.action === 'test' ? decisionStore.snapshot() : undefined }) }
}
