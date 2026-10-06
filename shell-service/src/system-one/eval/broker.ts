import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { DecisionError } from '../types.js'
import { evalService, type EvalService } from './service.js'
export class EvalBroker {
  private server?: Server
  private starting?: Promise<void>
  private url = ''
  private tokens = new Set<string>()
  constructor(private service: EvalService = evalService) {}
  async grant() {
    if (!this.starting) this.starting = this.start()
    await this.starting
    const token = randomBytes(32).toString('hex'); this.tokens.add(token)
    return { url: this.url, token, revoke: () => { this.tokens.delete(token); this.service.cancelOwner(token) } }
  }
  private async start() {
    this.server = createServer(async (req, res) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const reply = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (req.headers.origin || !this.tokens.has(token) || req.method !== 'POST' || req.url !== '/s1-eval') { reply(403, { code: 'unauthorized' }); return }
      try {
        let size = 0; const chunks: Buffer[] = []
        for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new DecisionError('input_too_large'); chunks.push(Buffer.from(chunk)) }
        if (!this.tokens.has(token)) throw new DecisionError('unauthorized')
        reply(200, this.service.dispatch(JSON.parse(Buffer.concat(chunks).toString('utf8')), token))
      } catch (e) { reply(400, { code: e instanceof DecisionError ? e.code : 'invalid_request' }) }
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address(); if (!address || typeof address === 'string') throw new Error('eval_broker_unavailable')
    this.url = `http://127.0.0.1:${address.port}/s1-eval`; this.server.unref()
  }
  async close() { for (const token of this.tokens) this.service.cancelOwner(token); this.tokens.clear(); await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve()) }
}
export const evalBroker = new EvalBroker()
