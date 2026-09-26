import type { ShellEvent, ShellCommand } from "./ws-protocol"

type Listener = (ev: ShellEvent) => void

class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private url: string
  private retry = 0
  private timer: number | null = null
  private shouldReconnect = true
  /** Commands issued before the socket is open (cold start / reconnect). */
  private queue: string[] = []

  constructor(url: string) {
    this.url = url
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      this.retry = 0
      // full sync first, then anything the UI asked for while we were connecting
      this.send({ t: "list_projects" })
      const pending = this.queue
      this.queue = []
      for (const data of pending) this.ws?.send(data)
    }
    this.ws.onmessage = (e) => {
      try {
        const j = JSON.parse(e.data as string) as ShellEvent
        for (const l of this.listeners) l(j)
      } catch {}
    }
    this.ws.onclose = () => {
      if (!this.shouldReconnect) return
      const delay = Math.min(1000 * Math.pow(1.6, this.retry), 15000)
      this.retry++
      this.timer = window.setTimeout(() => this.connect(), delay)
    }
    this.ws.onerror = () => {
      // will trigger onclose
    }
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.timer) window.clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
    this.queue = []
  }

  send(cmd: ShellCommand | Record<string, unknown>) {
    const data = JSON.stringify(cmd)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return
    }
    // Dropping these silently was a real bug: the first get_session/list_sessions
    // fired at mount raced the handshake and vanished.
    if (this.shouldReconnect) {
      this.queue.push(data)
      if (this.queue.length > 100) this.queue.shift()
      this.connect()
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  // In dev, vite proxies /ws to 127.0.0.1:5174; use relative host so proxy applies.
  // Direct 5174 still works, but proxy avoids cross-port issues.
  return `${proto}//${location.host}/ws`
}

export const wsClient = new WsClient(wsUrl())
