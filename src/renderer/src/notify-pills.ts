export type NotifyLevel = 'info' | 'activity' | 'attention' | 'alert'

export type PillBucket = {
  level: NotifyLevel
  count: number
  lastTitle: string
  updatedAt: number
}

export type InAppNotifyExtended = {
  title: string
  body: string
  projectPath?: string
  cwd?: string
  ptyId?: string
  source: string
  level?: NotifyLevel
}

export const NOTIFY_PILLS_KEY = 'lemonade.notifyPills.v1'

const LEVEL_RANK: Record<NotifyLevel, number> = {
  info: 0,
  activity: 1,
  attention: 2,
  alert: 3
}

export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function pillKeyProject(root: string): string {
  return `project:${normPath(root)}`
}

export function pillKeyCwd(cwd: string): string {
  return `cwd:${normPath(cwd)}`
}

export function pillKeyPty(ptyId: string): string {
  return `pty:${ptyId}`
}

export function inferLevel(title: string, body: string, source: string): NotifyLevel {
  const t = `${title} ${body}`.toLowerCase()
  if (/\b(fail|error|fatal|exception|broken)\b/.test(t)) return 'alert'
  if (/\bwarn|warning|caution\b/.test(t)) return 'attention'
  if (source === 'verify_after') return 'attention'
  if (/\bverify\b.*\b(fail|error)\b/.test(t)) return 'alert'
  if (source === 'pty' || source === 'cli' || source === 'ui' || source === 'agent_exit') return 'activity'
  return 'info'
}

export function mergePill(prev: PillBucket | undefined, level: NotifyLevel, title: string): PillBucket {
  const count = (prev?.count ?? 0) + 1
  const prevRank = prev ? LEVEL_RANK[prev.level] : -1
  const newRank = LEVEL_RANK[level]
  const maxLevel = newRank >= prevRank ? level : prev!.level
  return {
    level: maxLevel,
    count,
    lastTitle: title.slice(0, 120),
    updatedAt: Date.now()
  }
}

export function bumpPillsFromNotify(
  prev: Record<string, PillBucket>,
  msg: InAppNotifyExtended
): Record<string, PillBucket> {
  const level = msg.level ?? inferLevel(msg.title, msg.body, msg.source)
  const keys: string[] = []
  if (msg.projectPath?.trim()) keys.push(pillKeyProject(msg.projectPath.trim()))
  if (msg.cwd?.trim()) keys.push(pillKeyCwd(msg.cwd.trim()))
  if (msg.ptyId?.trim()) keys.push(pillKeyPty(msg.ptyId.trim()))
  if (keys.length === 0) return prev
  const next = { ...prev }
  for (const k of keys) {
    next[k] = mergePill(next[k], level, msg.title)
  }
  return next
}

export function clearPillKey(prev: Record<string, PillBucket>, key: string): Record<string, PillBucket> {
  if (!(key in prev)) return prev
  const next = { ...prev }
  delete next[key]
  return next
}

export function loadPillMap(): Record<string, PillBucket> {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(NOTIFY_PILLS_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return {}
    const out: Record<string, PillBucket> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const level = o.level
      if (
        level !== 'info' &&
        level !== 'activity' &&
        level !== 'attention' &&
        level !== 'alert'
      )
        continue
      const count = typeof o.count === 'number' && o.count > 0 ? o.count : 1
      out[k] = {
        level,
        count,
        lastTitle: typeof o.lastTitle === 'string' ? o.lastTitle : '',
        updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now()
      }
    }
    return out
  } catch {
    return {}
  }
}

export function savePillMap(m: Record<string, PillBucket>): void {
  try {
    sessionStorage.setItem(NOTIFY_PILLS_KEY, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}
