import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type NotifyLevel = 'info' | 'activity' | 'attention' | 'alert'

export type NotifyPayload = {
  title: string
  body: string
  projectPath?: string
  /** Worktree / checkout path for sidebar pill routing */
  cwd?: string
  /** Same as cwd (alternate JSON key for scripts) */
  worktreePath?: string
  ptyId?: string
  level?: NotifyLevel
}

export type NotifyServerState = {
  port: number
  token: string
  stop: () => void
}

export function startNotifyHttpServer(opts: {
  userDataDir: string
  onRequest: (payload: NotifyPayload) => void
}): Promise<NotifyServerState> {
  const token = randomBytes(24).toString('hex')
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'http://127.0.0.1',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      })
      res.end()
      return
    }
    if (req.url !== '/notify' || req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }
    const auth = req.headers['authorization']
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const bearer =
          typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
        if (bearer !== token) {
          res.writeHead(401)
          res.end('unauthorized')
          return
        }
        const raw = Buffer.concat(chunks).toString('utf8')
        const body = JSON.parse(raw) as NotifyPayload
        if (typeof body.title !== 'string' || typeof body.body !== 'string') {
          res.writeHead(400)
          res.end('expected { title, body }')
          return
        }
        const lvl = body.level
        const level: NotifyLevel | undefined =
          lvl === 'info' || lvl === 'activity' || lvl === 'attention' || lvl === 'alert' ? lvl : undefined
        opts.onRequest({
          title: body.title.slice(0, 200),
          body: body.body.slice(0, 4000),
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
          cwd:
            typeof body.cwd === 'string'
              ? body.cwd
              : typeof body.worktreePath === 'string'
                ? body.worktreePath
                : undefined,
          ptyId: typeof body.ptyId === 'string' ? body.ptyId : undefined,
          level
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400)
        res.end()
      }
    })
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(join(opts.userDataDir, 'notify-endpoint.json'), JSON.stringify({ port, token }, null, 2))
      resolvePromise({
        port,
        token,
        stop: () => {
          server.close()
        }
      })
    })
  })
}
