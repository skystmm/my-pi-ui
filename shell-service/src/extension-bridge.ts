import type { WebSocketServer } from "ws"
import { liveSessions } from "./pi-adapter/index.js"
import { broadcast } from "./ws-util.js"

const BLOCKING_KINDS = new Set(["select", "confirm", "input", "editor"])
const ALLOWED_KINDS = new Set(["select", "confirm", "input", "notify", "setStatus", "setWidget", "editor", "setTitle", "set_editor_text"])

/**
 * Forward pi's extension UI requests to the browser. Blocking kinds
 * (select/confirm/input/editor) are answered by the ExtensionUIOverlay; the rest
 * (notify/setStatus/setWidget/setTitle) are fire-and-forget.
 */
export function attachExtensionBridge(wss: WebSocketServer) {
  liveSessions.on((ev) => {
    const payload = ev.payload as Record<string, unknown> | null
    if (!payload || typeof payload.type !== "string") return
    if (payload.type !== "extension_ui_request") return
    const method = String(payload["method"] ?? "")
    if (!ALLOWED_KINDS.has(method)) return
    broadcast(wss, {
      t: "extension_ui_request",
      cwd: ev.cwd,
      requestId: String(payload["id"] ?? ""),
      extensionId: typeof payload["extensionId"] === "string" ? payload["extensionId"] : undefined,
      kind: method as "select" | "confirm" | "input" | "notify" | "setStatus" | "setWidget" | "editor",
      data: { ...payload, blocking: BLOCKING_KINDS.has(method) },
    })
  })
}
