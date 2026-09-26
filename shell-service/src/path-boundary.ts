import { isAbsolute, relative, sep } from "node:path"

/** Check a resolved path against a resolved root, including the root itself. */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
