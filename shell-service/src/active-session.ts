// Which session each project's live pi adapter is currently bound to. pi runs one
// session per process, so this is the single source of truth for routing live
// transcript increments and for deciding whether a prompt needs a switch first.
const activeSessionByCwd = new Map<string, string>()

export function getActiveSession(cwd: string): string | undefined { return activeSessionByCwd.get(cwd) }
export function setActiveSession(cwd: string, sessionId: string): void { activeSessionByCwd.set(cwd, sessionId) }
export function forgetActiveSession(cwd: string): void { activeSessionByCwd.delete(cwd) }
