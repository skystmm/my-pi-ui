import type { Ctx } from '../../commands/context.js'
import type { ShellCommand } from '../../ws-protocol.js'
import { DecisionError } from '../types.js'
import { evalService } from './service.js'
export function evalCommand(ctx: Ctx, command: Extract<ShellCommand, { t: 'eval_command' }>) {
  try { if (typeof command.requestId !== 'string' || command.requestId.length > 128) throw new DecisionError('invalid_request'); const result = evalService.dispatch(command.input, 'ui'); ctx.send({ t: 'eval_result', requestId: command.requestId, ok: true, result }) }
  catch (e) { ctx.send({ t: 'eval_result', requestId: command.requestId, ok: false, code: e instanceof DecisionError ? e.code : 'invalid_request' }) }
}
