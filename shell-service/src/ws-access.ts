import type { Server } from "node:http"
import { WebSocketServer } from "ws"

function isLoopback(value: string | undefined): boolean {
  const address = value?.replace(/^::ffff:/, "")
  return address === "::1" || address === "127.0.0.1" || Boolean(address && /^127\.\d+\.\d+\.\d+$/.test(address))
}

/** Browser origins must be local; clients without Origin must connect locally. */
export function isWebSocketRequestAllowed(origin: string | undefined, remoteAddress: string | undefined): boolean {
  if (!isLoopback(remoteAddress)) return false
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  } catch {
    return false
  }
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
