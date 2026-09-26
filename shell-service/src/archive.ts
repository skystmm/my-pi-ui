// UI-only archive index. Pi's session JSONL files remain in their original locations.
import { join } from "node:path"
import { getAgentDir } from "./paths.js"
import { mutateJsonFile, readJsonFile } from "./atomic-write.js"
import type { ProjectMeta, SessionMeta } from "./ws-protocol.js"

type ArchiveIndex = { version: 1; projects: string[]; sessions: { projectId: string; sessionId: string }[] }
const empty = (): ArchiveIndex => ({ version: 1, projects: [], sessions: [] })
const indexPath = () => join(getAgentDir(), "pi-ui-archive.json")

function normalize(value: ArchiveIndex | null): ArchiveIndex {
  if (value?.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.sessions)) return empty()
  return {
    version: 1,
    projects: value.projects.filter((id): id is string => typeof id === "string"),
    sessions: value.sessions.filter((s): s is { projectId: string; sessionId: string } =>
      !!s && typeof s.projectId === "string" && typeof s.sessionId === "string"),
  }
}

function readIndex(): ArchiveIndex {
  return normalize(readJsonFile<ArchiveIndex>(indexPath()))
}

export function markProjects(projects: ProjectMeta[]): ProjectMeta[] {
  const archived = new Set(readIndex().projects)
  return projects.map(p => ({ ...p, archived: archived.has(p.id) }))
}

export function markSessions(projectId: string, sessions: SessionMeta[]): SessionMeta[] {
  const archived = new Set(readIndex().sessions.filter(s => s.projectId === projectId).map(s => s.sessionId))
  return sessions.map(s => ({ ...s, archived: archived.has(s.id) }))
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<void> {
  await mutateJsonFile<ArchiveIndex>(indexPath(), value => {
    const cur = normalize(value)
    return {
      ...cur,
      projects: archived ? [...new Set([...cur.projects, projectId])] : cur.projects.filter(id => id !== projectId),
    }
  }, empty())
}

export async function setSessionArchived(projectId: string, sessionId: string, archived: boolean): Promise<void> {
  await mutateJsonFile<ArchiveIndex>(indexPath(), value => {
    const cur = normalize(value)
    return {
      ...cur,
      sessions: archived
        ? [...cur.sessions.filter(s => !(s.projectId === projectId && s.sessionId === sessionId)), { projectId, sessionId }]
        : cur.sessions.filter(s => !(s.projectId === projectId && s.sessionId === sessionId)),
    }
  }, empty())
}
