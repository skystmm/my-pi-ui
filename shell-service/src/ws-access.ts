import type { Server } from "node:http"
import { WebSocketServer } from "ws"

function isLoopback(value: string | undefined): boolean {
  const address = value?.replace(/^::ffff:/, "")
  return address === "::1" || address === "127.0.0.1" || Boolean(address && /^127\.\d+\.\d+\.\d+$/.test(address))
}

const defaultOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173", "http://[::1]:5173"])

function allowedOrigins(): Set<string> {
  const origins = new Set(defaultOrigins)
  for (const value of (process.env.PI_UI_ORIGINS ?? "").split(",")) {
    const origin = value.trim()
    if (!origin) continue
    try {
      const url = new URL(origin)
      if ((url.protocol === "http:" || url.protocol === "https:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
        url.origin === origin) origins.add(origin)
    } catch { /* invalid configured origin is ignored */ }
  }
  return origins
}

/** Only the local UI origin may access the socket; originless local clients remain supported. */
export function isWebSocketRequestAllowed(origin: string | undefined, remoteAddress: string | undefined): boolean {
  if (!isLoopback(remoteAddress)) return false
  if (origin === undefined) return true
  return allowedOrigins().has(origin)
}

/** Keep the access check on the upgrade path, before any snapshot is sent. */
export function createGuardedWebSocketServer(server: Server): WebSocketServer {
  return new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ req }, done) => {
      const allowed = isWebSocketRequestAllowed(req.headers.origin, req.socket.remoteAddress)
      done(allowed, allowed ? undefined : 403, allowed ? undefined : "Forbidden")
    },
  })
}
