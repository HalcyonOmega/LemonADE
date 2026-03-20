import { basename, join } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'

export type ProjectConfig = {
  name: string
  previewUrl: string
  devPort?: number
  verifyCommand?: string
  agentCommand?: string
}

const LEGACY_MANIFEST = 'lemonade.project.json'

function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Merge `.lemonade/settings.json`, legacy `lemonade.project.json`, and folder name defaults. */
export function resolveProjectConfig(root: string): ProjectConfig {
  const modern = readJsonFile<Partial<ProjectConfig>>(join(root, '.lemonade', 'settings.json'))
  const legacy = readJsonFile<Partial<ProjectConfig>>(join(root, LEGACY_MANIFEST))
  const label = basename(root)

  return {
    name: modern?.name ?? legacy?.name ?? label,
    previewUrl: modern?.previewUrl ?? legacy?.previewUrl ?? '',
    devPort: modern?.devPort ?? legacy?.devPort,
    verifyCommand: modern?.verifyCommand ?? legacy?.verifyCommand,
    agentCommand: modern?.agentCommand ?? legacy?.agentCommand
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
