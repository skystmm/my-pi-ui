import type { WebSocket, WebSocketServer } from "ws"
import type { ShellEvent } from "../ws-protocol.js"

/** Everything a command handler needs; assembled once per connection. */
export type Ctx = {
  ws: WebSocket
  wss: WebSocketServer
  send: (event: ShellEvent) => void
  broadcast: (event: ShellEvent) => void
  fail: (code: string, message: string) => void
  /** canonicalized cwd that must exist, else an error is sent and null returned */
  cwdOrError: (raw: string | undefined, missingMsg: string) => Promise<string | null>
}
