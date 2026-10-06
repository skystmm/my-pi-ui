import type { EvalInput } from './types.js'
export function parseEvalCommand(args: string): EvalInput {
  const words = args.trim().split(/\s+/).filter(Boolean), action = words.shift() ?? 'suites'
  const options: Record<string, string> = {}, positionals: string[] = []
  while (words.length) { const word = words.shift()!; if (word.startsWith('--')) { if (options[word] || !words[0] || words[0].startsWith('--')) throw new Error('invalid_arguments'); options[word] = words.shift()! } else positionals.push(word) }
  const allowed = action === 'run' ? ['--suite', '--models', '--repeats'] : action === 'validate' ? ['--suite'] : action === 'compare' ? ['--baseline'] : []
  if (Object.keys(options).some(o => !allowed.includes(o)) || positionals.length > (['status', 'cancel', 'report', 'compare'].includes(action) ? 1 : 0)) throw new Error('invalid_arguments')
  if (action === 'run') { if (!options['--models']) throw new Error('models_required'); return { action, spec: { suiteId: options['--suite'] ?? 'smoke-v1', modelIds: options['--models'].split(','), repeats: options['--repeats'] === undefined ? 1 : Number(options['--repeats']) } } }
  if (action === 'validate') return { action, suiteId: options['--suite'] ?? 'smoke-v1' }
  if (['status', 'cancel', 'report', 'compare'].includes(action)) { if (!positionals[0] || (action === 'compare' && !options['--baseline'])) throw new Error('run_id_required'); return { action: action as EvalInput['action'], runId: positionals[0], baselineId: options['--baseline'] } }
  if (action === 'suites' || action === 'list') return { action }
  throw new Error('unknown_action')
}
