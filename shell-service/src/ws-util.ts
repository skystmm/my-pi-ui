import { WebSocket, type WebSocketServer } from "ws"
import type { ShellEvent } from "./ws-protocol.js"

export function send(ws: WebSocket, event: ShellEvent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
}

export function broadcast(wss: WebSocketServer, event: ShellEvent): void {
  const data = JSON.stringify(event)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data)
  }
}

/**
 * Which session each client has open. Several sessions share one cwd, so live
 * increments are unicast by session id rather than broadcast by cwd.
 */
const openSessionByWs = new WeakMap<WebSocket, { projectId: string; sessionId: string; cwd: string }>()

export function setOpenSession(ws: WebSocket, projectId: string, sessionId: string, cwd: string): void {
  openSessionByWs.set(ws, { projectId, sessionId, cwd })
}

export function getOpenSession(ws: WebSocket) { return openSessionByWs.get(ws) }

export function openSessions(wss: WebSocketServer): { projectId: string; sessionId: string; cwd: string }[] {
  const out: { projectId: string; sessionId: string; cwd: string }[] = []
  for (const client of wss.clients) {
    const o = openSessionByWs.get(client as WebSocket)
    if (o) out.push(o)
  }
  return out
}

export function sendToSession(wss: WebSocketServer, sessionId: string, event: ShellEvent): void {
  if (!sessionId) return // target unknown: the client gets the truth on its next get_session
  const data = JSON.stringify(event)
  for (const client of wss.clients) {
    const c = client as WebSocket
    if (c.readyState !== WebSocket.OPEN) continue
    if (openSessionByWs.get(c)?.sessionId === sessionId) c.send(data)
  }
}
