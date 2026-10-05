import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { decisionStore, type DecisionStore } from './store.js'
import { evaluateDecision } from './client.js'
import { DecisionError } from './types.js'
export class DecisionBroker {
  private server?: Server
  private url = ''
  private starting?: Promise<void>
  private identities = new Map<string, { cwd: string; controllers: Set<AbortController> }>()
  private counts = new Map<string, number>()
  constructor(private store: DecisionStore = decisionStore) {}
  async grant(cwd: string) {
    if (!this.starting) this.starting = this.start()
    await this.starting
    const token = randomBytes(32).toString('hex'); this.identities.set(token, { cwd, controllers: new Set() })
    return { url: this.url, token, revoke: () => { const item = this.identities.get(token); item?.controllers.forEach(c => c.abort()); this.identities.delete(token) } }
  }
  private async start() {
    this.server = createServer(async (req, res) => {
      const identity = this.identities.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
      const reply = (status: number, data: unknown) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) } }
      if (req.headers.origin || !identity || req.method !== 'POST' || req.url !== '/evaluate') { reply(403, { code: 'unauthorized' }); return }
      const ctrl = new AbortController(); identity.controllers.add(ctrl)
      res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
      let providerId: string | undefined
      let acquired = false
      try {
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new DecisionError('input_too_large'); chunks.push(Buffer.from(chunk)) }
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8')); const config = this.store.resolve(identity.cwd)
        providerId = config.provider.id
        if ((this.counts.get(providerId) ?? 0) >= 2) throw new DecisionError('busy')
        this.counts.set(providerId, (this.counts.get(providerId) ?? 0) + 1)
        acquired = true
        const result = await evaluateDecision(config, request, ctrl.signal); reply(200, result)
      } catch (e) { reply(400, { code: e instanceof DecisionError ? e.code : 'invalid_request' }) }
      finally { identity.controllers.delete(ctrl); if (providerId && acquired) this.counts.set(providerId, Math.max(0, (this.counts.get(providerId) ?? 0) - 1)) }
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address(); if (!address || typeof address === 'string') throw new Error('broker_unavailable')
    this.url = `http://127.0.0.1:${address.port}/evaluate`; this.server.unref()
  }
  async close() { for (const i of this.identities.values()) i.controllers.forEach(c => c.abort()); this.identities.clear(); await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve()) }
}
export const decisionBroker = new DecisionBroker()
