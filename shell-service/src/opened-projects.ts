import { join } from "node:path"
import { readJsonFile, mutateJsonFile } from "./atomic-write.js"
import { getAgentDir } from "./paths.js"

interface OpenedProjectsFile { version: 1; paths: string[] }

function indexPath(): string { return join(getAgentDir(), "pi-ui-projects.json") }

export function readOpenedProjects(): string[] {
  return readPaths(readJsonFile<OpenedProjectsFile>(indexPath()))
}

export async function rememberOpenedProject(cwd: string): Promise<void> {
  await mutateJsonFile<OpenedProjectsFile>(indexPath(), current => ({
    version: 1,
    paths: [...new Set([...readPaths(current), cwd])],
  }), { version: 1, paths: [] })
}

function readPaths(data: OpenedProjectsFile | null): string[] {
  return data?.version === 1 && Array.isArray(data.paths)
    ? data.paths.filter((path): path is string => typeof path === "string" && path.startsWith("/"))
    : []
}
