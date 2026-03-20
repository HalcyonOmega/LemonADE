import { resolve, normalize, relative, sep } from 'node:path'

/** True if `candidatePath` (absolute or relative to root) stays inside `rootDir`. */
export function isPathInsideDir(rootDir: string, candidatePath: string): boolean {
  const root = resolve(normalize(rootDir))
  const full = resolve(root, normalize(candidatePath))
  const relPath = relative(root, full)
  if (relPath === '' || relPath === '.') return true
  if (relPath.startsWith('..')) return false
  return !relPath.split(sep).includes('..')
}
