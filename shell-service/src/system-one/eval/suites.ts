import { createHash } from 'node:crypto'
import { DecisionError } from '../types.js'
import type { EvalSuite } from './types.js'
export const smokeSuite: EvalSuite = { id: 'smoke-v1', version: 1, purpose: 'smoke', cases: [
  { id: 'choice-en', sourceGroup: 'review-intent', language: 'en', tags: ['intent'], request: { state: 'Please review this existing code change.', questions: { decision: { type: 'choice', instructions: 'Which task does the user request?', criteria: { review: 'Review existing code', build: 'Create new code' } } } }, expected: { type: 'choice', label: 'review' } },
  { id: 'choice-zh', sourceGroup: 'review-intent', language: 'zh', tags: ['intent'], request: { state: '请审查这次已有的代码改动。', questions: { decision: { type: 'choice', instructions: '用户请求哪一类任务？', criteria: { review: '审查已有代码', build: '创建新的代码' } } } }, expected: { type: 'choice', label: 'review' } },
  { id: 'noul-en', sourceGroup: 'irrelevant-context', language: 'en', tags: ['context'], request: { state: 'The restaurant serves noodles and tea.', questions: { decision: { type: 'noul', instructions: 'Does this text contain information relevant to fixing a TypeScript compiler error?' } } }, expected: { type: 'noul', label: false } },
  { id: 'noul-zh', sourceGroup: 'relevant-context', language: 'zh', tags: ['context'], request: { state: 'TypeScript 报错 TS2322：不能将 string 分配给 number。请修复这个类型错误。', questions: { decision: { type: 'noul', instructions: '这段文字是否包含与修复 TypeScript 编译错误相关的信息？' } } }, expected: { type: 'noul', label: true } },
  { id: 'score-en', sourceGroup: 'direct-review', language: 'en', tags: ['relevance'], request: { state: 'Please review the code in this pull request.', questions: { decision: { type: 'score', instructions: 'How relevant is this request to code review?', criteria: ['Unrelated', 'Indirectly related', 'Directly requests code review'] } } }, expected: { type: 'score', label: 2, tolerance: 0 } },
  { id: 'score-zh', sourceGroup: 'unrelated-review', language: 'zh', tags: ['relevance'], request: { state: '请推荐晚餐吃什么。', questions: { decision: { type: 'score', instructions: '这个请求与代码审查有多相关？', criteria: ['无关', '间接相关', '直接请求代码审查'] } } }, expected: { type: 'score', label: 0, tolerance: 0 } },
] }
export function suite(id: string): EvalSuite { if (id !== smokeSuite.id) throw new DecisionError('unknown_suite'); return structuredClone(smokeSuite) }
export function suiteHash(value: EvalSuite) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
export function validateSuite(id: string) {
  const value = suite(id); const ids = new Set<string>()
  for (const item of value.cases) {
    const q = item.request.questions.decision
    if (ids.has(item.id) || !item.sourceGroup || !q || q.type !== item.expected.type) throw new DecisionError('invalid_suite')
    ids.add(item.id)
    if (item.expected.type === 'choice' && (!q.criteria || Array.isArray(q.criteria) || !Object.hasOwn(q.criteria, item.expected.label))) throw new DecisionError('invalid_suite')
    if (item.expected.type === 'score' && (!Array.isArray(q.criteria) || !Number.isInteger(item.expected.label) || item.expected.label < 0 || item.expected.label >= q.criteria.length)) throw new DecisionError('invalid_suite')
  }
  return { id, hash: suiteHash(value), cases: value.cases.length, purpose: value.purpose, valid: true }
}
