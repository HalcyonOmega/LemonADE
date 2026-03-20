import { spawn } from 'node:child_process'

export type WorktreeEntry = {
  path: string
  head: string
  branch: string
  detached: boolean
}

/** Parse `git worktree list --porcelain` (empty if not a repo or git missing). */
export function listGitWorktrees(root: string): Promise<WorktreeEntry[]> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', (c: string) => {
      out += c
    })
    proc.on('error', () => resolve([]))
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve([])
        return
      }
      resolve(parsePorcelain(out))
    })
  })
}

function parsePorcelain(raw: string): WorktreeEntry[] {
  const lines = raw.split(/\r?\n/)
  const rows: WorktreeEntry[] = []
  let cur: Partial<WorktreeEntry> & { path?: string } = {}

  const flush = (): void => {
    if (cur.path) {
      rows.push({
        path: cur.path,
        head: cur.head ?? '',
        branch: cur.branch ?? '',
        detached: !!cur.detached
      })
    }
    cur = {}
  }

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      flush()
      cur.path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      cur.branch = ref.replace(/^refs\/heads\//, '')
      cur.detached = false
    } else if (line === 'detached') {
      cur.detached = true
      cur.branch = '(detached)'
    }
  }
  flush()
  return rows
}
