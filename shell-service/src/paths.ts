import { join } from "node:path"
import { homedir } from "node:os"

function expandTilde(p: string): string {
  if (!p) return p
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

export function getAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim()
  if (env) return expandTilde(env)
  return join(homedir(), ".pi", "agent")
}

export function getSessionsDir(): string {
  const env = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()
  if (env) return expandTilde(env)
  return join(getAgentDir(), "sessions")
}

export function getAuthPath(): string {
  return join(getAgentDir(), "auth.json")
}

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json")
}

export function getTrustPath(): string {
  return join(getAgentDir(), "trust.json")
}
