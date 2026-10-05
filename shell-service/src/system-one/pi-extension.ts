// Pure JSON schema avoids runtime imports from the user's Pi installation.
export default function systemOne(pi: { registerTool: (tool: any) => void }) {
  pi.registerTool({
    name: 'system_one_evaluate', label: 'System One',
    description: 'Evaluate bounded choice, score or yes/no questions using the decision model configured by the user. Returns probabilities, not generated prose. Send only relevant context. Cannot authorize actions or select a provider.',
    parameters: { type: 'object', additionalProperties: false, required: ['state', 'questions'], properties: { state: {}, questions: { type: 'object', minProperties: 1, maxProperties: 64, additionalProperties: { type: 'object', additionalProperties: false, required: ['type', 'instructions'], properties: { type: { enum: ['choice', 'score', 'noul'] }, instructions: { type: 'string' }, criteria: { anyOf: [{ type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, { type: 'array', items: { type: 'string' } }] } } } } } },
    async execute(_id: string, params: unknown, signal?: AbortSignal) {
      const url = process.env.PI_UI_DECISION_URL; const token = process.env.PI_UI_DECISION_TOKEN
      if (!url || !token) throw new Error('System One: not_configured')
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal })
      const data = await response.json() as { code?: string }
      if (!response.ok) throw new Error(`System One: ${data.code ?? 'unavailable'}`)
      return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data }
    },
  })
}
