// Real usage/context data from pi (get_session_stats):
//   { tokens:{input,output,cacheRead,cacheWrite,total}, cost, counts, contextUsage }
// plus reserveTokens from settings.json (pi default 16384). contextUsage is null
// when the model has no contextWindow — i.e. nothing is configured — so the UI
// must render "—", never a hardcoded percent.
import type { WebSocketServer } from "ws"
import { liveSessions } from "./pi-adapter/index.js"
import { getCompactionReserveTokens } from "./settings-service.js"
import { setActiveSession } from "./active-session.js"
import { broadcast } from "./ws-util.js"

export async function pushSessionStats(wss: WebSocketServer, cwd: string): Promise<void> {
  try {
    const adapter = liveSessions.peek(cwd)
    if (!adapter) return
    const d = await adapter.getSessionStats() as {
      sessionId?: unknown; tokens?: unknown; cost?: unknown;
      userMessages?: unknown; assistantMessages?: unknown; toolCalls?: unknown;
      toolResults?: unknown; totalMessages?: unknown; contextUsage?: unknown;
    }
    if (!d || typeof d.sessionId !== "string") return
    setActiveSession(cwd, d.sessionId)

    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0
    const t = (d.tokens ?? {}) as Record<string, unknown>
    const cu = d.contextUsage as { tokens?: unknown; contextWindow?: unknown; percent?: unknown } | undefined
    broadcast(wss, {
      t: "session_stats", cwd, sessionId: d.sessionId,
      stats: {
        tokens: { input: num(t["input"]), output: num(t["output"]), cacheRead: num(t["cacheRead"]), cacheWrite: num(t["cacheWrite"]), total: num(t["total"]) },
        cost: num(d.cost),
        counts: { userMessages: num(d.userMessages), assistantMessages: num(d.assistantMessages), toolCalls: num(d.toolCalls), toolResults: num(d.toolResults), totalMessages: num(d.totalMessages) },
        contextUsage: cu && typeof cu.contextWindow === "number" && cu.contextWindow > 0
          ? {
              tokens: typeof cu.tokens === "number" ? cu.tokens : null,
              contextWindow: cu.contextWindow,
              percent: typeof cu.percent === "number" ? cu.percent : null,
            }
          : null,
        reserveTokens: getCompactionReserveTokens(cwd),
      },
    })
  } catch { /* stats are best-effort; the conversation stream is authoritative */ }
}

const timers = new Map<string, NodeJS.Timeout>()

/** Trailing debounce: streaming produces many events, stats only need the latest. */
export function scheduleStatsPush(wss: WebSocketServer, cwd: string): void {
  const prev = timers.get(cwd)
  if (prev) clearTimeout(prev)
  timers.set(cwd, setTimeout(() => { timers.delete(cwd); void pushSessionStats(wss, cwd) }, 800))
}
