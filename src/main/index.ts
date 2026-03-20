import {
  app,
  shell,
  BrowserWindow,
  BrowserView,
  ipcMain,
  dialog,
  Notification,
  type WebContents
} from 'electron'
import { dirname, join, resolve, relative, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as pty from 'node-pty'
import { resolveProjectConfig, isDirectory } from './project-config'
import { listGitWorktrees } from './git-worktrees'
import { isPathInsideDir } from './safe-path'
import {
  startNotifyHttpServer,
  type NotifyLevel,
  type NotifyServerState
} from './notify-endpoint'

const __dirname = dirname(fileURLToPath(import.meta.url))

function preloadPath(): string {
  const js = join(__dirname, '../preload/index.js')
  const mjs = join(__dirname, '../preload/index.mjs')
  if (existsSync(js)) return js
  if (existsSync(mjs)) return mjs
  return js
}

type WorkspaceFile = { projectPaths: string[] }

type PtyMeta = {
  projectPath: string
  cwd: string
  agentSession: boolean
  verifyCommand?: string
  agentLabel?: string
}

let mainWindow: BrowserWindow | null = null
let previewView: BrowserView | null = null
let notifyServer: NotifyServerState | null = null
const ptySessions = new Map<string, { pty: pty.IPty; meta: PtyMeta }>()
const ptyNotifyLineBuf = new Map<string, string>()
let ptySeq = 0

function broadcastInAppNotify(payload: {
  title: string
  body: string
  projectPath?: string
  cwd?: string
  ptyId?: string
  source: string
  level?: NotifyLevel
}): void {
  mainWindow?.webContents.send('lemonade:in-app-notify', payload)
}

function notifyEnvForPty(): Record<string, string> {
  if (!notifyServer) return {}
  return {
    LEMONADE_NOTIFY_PORT: String(notifyServer.port),
    LEMONADE_NOTIFY_TOKEN: notifyServer.token
  }
}

function drainPtyNotifyLines(id: string, chunk: string, meta: PtyMeta, sender: WebContents): void {
  const prev = ptyNotifyLineBuf.get(id) ?? ''
  const combined = prev + chunk
  const lines = combined.split(/\r?\n/)
  const tail = lines.pop() ?? ''
  ptyNotifyLineBuf.set(id, tail)
  const prefix = 'LEMONADE_NOTIFY_JSON:'
  for (const line of lines) {
    if (!line.startsWith(prefix)) continue
    try {
      const j = JSON.parse(line.slice(prefix.length)) as {
        title?: string
        body?: string
        level?: string
        cwd?: string
      }
      if (typeof j.title !== 'string' || typeof j.body !== 'string') continue
      const lv = j.level
      const level: NotifyLevel | undefined =
        lv === 'info' || lv === 'activity' || lv === 'attention' || lv === 'alert' ? lv : undefined
      showNotification(j.title.slice(0, 200), j.body.slice(0, 2000), meta.projectPath, 'pty_notify', true)
      broadcastInAppNotify({
        title: j.title,
        body: j.body,
        projectPath: meta.projectPath,
        cwd: typeof j.cwd === 'string' ? j.cwd : meta.cwd,
        ptyId: id,
        source: 'pty',
        level
      })
    } catch {
      /* ignore malformed */
    }
  }
}

function workspacePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspace.json')
}

function loadWorkspace(): WorkspaceFile {
  const p = workspacePath()
  if (!existsSync(p)) return { projectPaths: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as WorkspaceFile
  } catch {
    return { projectPaths: [] }
  }
}

function saveWorkspace(w: WorkspaceFile): void {
  writeFileSync(workspacePath(), JSON.stringify(w, null, 2), 'utf-8')
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function shellArgs(): string[] {
  if (process.platform === 'win32') return []
  return ['-l']
}

/** Interactive agent (e.g. OpenAI Codex CLI) via shell — keeps quoting and PATH consistent. */
function spawnAgentProgram(
  command: string,
  opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }
): pty.IPty {
  const cmd = command.trim()
  if (process.platform === 'win32') {
    const com = process.env.ComSpec || 'cmd.exe'
    return pty.spawn(com, ['/d', '/s', '/c', cmd], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env
    })
  }
  return pty.spawn('/bin/sh', ['-lc', cmd], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env
  })
}

function ensurePreviewView(): BrowserView {
  if (!mainWindow) throw new Error('No main window')
  if (previewView) return previewView
  const v = new BrowserView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true
    }
  })
  mainWindow.addBrowserView(v)
  previewView = v
  return v
}

function removePreviewView(): void {
  if (!mainWindow || !previewView) return
  mainWindow.removeBrowserView(previewView)
  ;(previewView.webContents as { destroy?: () => void }).destroy?.()
  previewView = null
}

function showNotification(title: string, body: string, projectPath: string, kind: string, ok: boolean): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title,
    body,
    silent: false
  })
  n.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('lemonade:notification-click', { projectPath, kind, ok })
  })
  n.show()
}

function runVerify(
  cwd: string,
  command: string,
  onChunk: (s: string) => void
): Promise<number> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const proc: ChildProcessWithoutNullStreams = isWin
      ? spawn(command, [], { cwd, shell: true, env: { ...process.env } })
      : spawn('sh', ['-c', command], { cwd, env: { ...process.env } })
    proc.stdout.on('data', (d) => onChunk(d.toString()))
    proc.stderr.on('data', (d) => onChunk(d.toString()))
    proc.on('close', (code) => resolve(code ?? 1))
    proc.on('error', () => resolve(1))
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'LemonADE',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    if (process.env['LEMONADE_OPEN_DEVTOOLS'] === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    removePreviewView()
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle('workspace:list', async () => {
    const w = loadWorkspace()
    return w.projectPaths.map((root) => ({
      root,
      config: resolveProjectConfig(root)
    }))
  })

  ipcMain.handle('workspace:add', async (_, dir: string) => {
    if (!isDirectory(dir)) {
      return { ok: false as const, error: 'Not a directory' }
    }
    const w = loadWorkspace()
    const norm = dir
    if (!w.projectPaths.includes(norm)) w.projectPaths.push(norm)
    saveWorkspace(w)
    return { ok: true as const }
  })

  ipcMain.handle('git:worktrees', async (_, root: string) => {
    const worktrees = await listGitWorktrees(root)
    return { worktrees }
  })

  ipcMain.handle('workspace:remove', async (_, root: string) => {
    const w = loadWorkspace()
    w.projectPaths = w.projectPaths.filter((p) => p !== root)
    saveWorkspace(w)
    return { ok: true as const }
  })

  ipcMain.handle('dialog:pickProject', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('app:platform', async () => process.platform)

  ipcMain.handle(
    'notify:show',
    async (
      _,
      p: {
        title: string
        body: string
        projectPath?: string
        cwd?: string
        ptyId?: string
        level?: NotifyLevel
      }
    ) => {
      const title = p.title.slice(0, 200)
      const body = p.body.slice(0, 2000)
      showNotification(title, body, p.projectPath ?? '', 'user_notify', true)
      broadcastInAppNotify({
        title,
        body,
        projectPath: p.projectPath,
        cwd: p.cwd,
        ptyId: p.ptyId,
        source: 'ui',
        level: p.level
      })
    }
  )

  ipcMain.handle('notify:getEndpoint', async () => {
    if (!notifyServer) return null
    return {
      url: `http://127.0.0.1:${notifyServer.port}/notify`,
      token: notifyServer.token
    }
  })

  ipcMain.handle('dialog:pickFile', async (_, cwd: string) => {
    if (!isDirectory(cwd)) return { error: 'baddir' as const }
    const opts = { defaultPath: cwd, properties: ['openFile' as const] }
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const abs = r.filePaths[0]
    const root = resolve(normalize(cwd))
    const full = resolve(normalize(abs))
    const relPath = relative(root, full)
    if (relPath.startsWith('..') || relPath.includes(`..${sep}`)) return { error: 'outsidecwd' as const }
    return { relPath: relPath.split(sep).join('/') }
  })

  ipcMain.handle(
    'fs:readText',
    async (_, opts: { root: string; relPath: string }) => {
      const root = resolve(normalize(opts.root))
      const full = resolve(root, normalize(opts.relPath))
      if (!isPathInsideDir(root, full)) return { ok: false as const, error: 'path' }
      if (!existsSync(full)) return { ok: false as const, error: 'notfound' }
      try {
        const text = readFileSync(full, 'utf-8')
        return { ok: true as const, text }
      } catch {
        return { ok: false as const, error: 'read' }
      }
    }
  )

  ipcMain.handle(
    'fs:writeText',
    async (_, opts: { root: string; relPath: string; text: string }) => {
      const root = resolve(normalize(opts.root))
      const full = resolve(root, normalize(opts.relPath))
      if (!isPathInsideDir(root, full)) return { ok: false as const, error: 'path' }
      try {
        writeFileSync(full, opts.text, 'utf-8')
        return { ok: true as const }
      } catch {
        return { ok: false as const, error: 'write' }
      }
    }
  )

  const SKIP_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'target',
    '__pycache__'
  ])

  ipcMain.handle(
    'fs:listDir',
    async (_, opts: { root: string; relPath: string }) => {
      const root = resolve(normalize(opts.root))
      const rel = (opts.relPath || '.').replace(/\\/g, '/')
      const full = resolve(root, normalize(rel))
      if (!isPathInsideDir(root, full)) return { ok: false as const, error: 'path' }
      try {
        if (!existsSync(full)) return { ok: false as const, error: 'notfound' }
        if (!statSync(full).isDirectory()) return { ok: false as const, error: 'notdir' }
        const dirents = readdirSync(full, { withFileTypes: true })
        const entries = dirents
          .filter((e) => e.name !== '.' && e.name !== '..')
          .filter((e) => !SKIP_DIR_NAMES.has(e.name))
          .map((e) => {
            const childRel = rel === '.' ? e.name : `${rel}/${e.name}`
            return {
              name: e.name,
              isDir: e.isDirectory(),
              relPath: childRel.split(sep).join('/')
            }
          })
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
          })
          .slice(0, 800)
        return { ok: true as const, entries }
      } catch {
        return { ok: false as const, error: 'read' }
      }
    }
  )

  ipcMain.handle('preview:setUrl', async (_, url: string | null) => {
    if (!mainWindow) return
    if (!url) {
      removePreviewView()
      return
    }
    const v = ensurePreviewView()
    try {
      await v.webContents.loadURL(url)
    } catch (err) {
      // Dev server down, bad URL, TLS, etc. — avoid rejecting IPC (stops console spam / handler errors).
      console.warn('[lemonade] preview load failed:', url, err)
      removePreviewView()
    }
  })

  ipcMain.handle('preview:setBounds', async (_, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!previewView || !mainWindow) return
    if (bounds.width < 20 || bounds.height < 20) return
    const c = mainWindow.getContentBounds()
    const x0 = Math.floor(bounds.x)
    const y0 = Math.floor(bounds.y)
    const w0 = Math.floor(bounds.width)
    const h0 = Math.floor(bounds.height)
    const x = Math.max(0, Math.min(x0, Math.max(0, c.width - 24)))
    const y = Math.max(0, Math.min(y0, Math.max(0, c.height - 24)))
    const w = Math.max(24, Math.min(w0, c.width - x))
    const h = Math.max(24, Math.min(h0, c.height - y))
    previewView.setBounds({ x, y, width: w, height: h })
  })

  ipcMain.handle('verify:run', async (event, opts: { cwd: string; command: string }) => {
    const lines: string[] = []
    const code = await runVerify(opts.cwd, opts.command, (chunk) => {
      lines.push(chunk)
      event.sender.send('verify:chunk', chunk)
    })
    return { code, ok: code === 0 }
  })

  ipcMain.handle('pty:write', async (_, payload: { id: string; data: string }) => {
    const s = ptySessions.get(payload.id)
    if (!s) return { ok: false as const }
    s.pty.write(payload.data)
    return { ok: true as const }
  })

  ipcMain.handle('pty:resize', async (_, payload: { id: string; cols: number; rows: number }) => {
    const s = ptySessions.get(payload.id)
    if (!s) return { ok: false as const }
    s.pty.resize(payload.cols, payload.rows)
    return { ok: true as const }
  })

  ipcMain.handle('pty:kill', async (_, id: string) => {
    const s = ptySessions.get(id)
    if (!s) return { ok: false as const }
    s.pty.kill()
    ptySessions.delete(id)
    return { ok: true as const }
  })

  ipcMain.handle('pty:spawn', async (event, opts: {
    projectPath: string
    cwd: string
    cols: number
    rows: number
    env?: Record<string, string>
    agentSession?: boolean
    verifyCommand?: string
    agentLabel?: string
    /** When set on an agent session, run this via shell instead of a login shell (e.g. `codex`). */
    agentInteractiveCommand?: string
  }) => {
    const id = `pty-${++ptySeq}`
    const shellPath = defaultShell()
    const args = shellArgs()
    const mergedEnv = {
      ...process.env,
      ...opts.env,
      ...notifyEnvForPty()
    } as Record<string, string>
    const meta: PtyMeta = {
      projectPath: opts.projectPath,
      cwd: opts.cwd,
      agentSession: !!opts.agentSession,
      verifyCommand: opts.verifyCommand,
      agentLabel: opts.agentLabel
    }
    const useAgentCmd =
      !!opts.agentSession &&
      typeof opts.agentInteractiveCommand === 'string' &&
      opts.agentInteractiveCommand.trim().length > 0
    const term =
      useAgentCmd
        ? spawnAgentProgram(opts.agentInteractiveCommand!.trim(), {
            cwd: opts.cwd,
            cols: opts.cols,
            rows: opts.rows,
            env: mergedEnv
          })
        : pty.spawn(shellPath, args, {
            name: 'xterm-256color',
            cols: opts.cols,
            rows: opts.rows,
            cwd: opts.cwd,
            env: mergedEnv
          })
    ptySessions.set(id, { pty: term, meta })
    term.onData((data) => {
      const ent = ptySessions.get(id)
      if (ent) drainPtyNotifyLines(id, data, ent.meta, event.sender)
      event.sender.send('pty:output', { id, data })
    })
    term.onExit(async ({ exitCode }) => {
      ptyNotifyLineBuf.delete(id)
      const entry = ptySessions.get(id)
      ptySessions.delete(id)
      event.sender.send('pty:exit', { id, exitCode })
      if (!entry) return
      const { meta: m } = entry
      if (m.agentSession && m.verifyCommand) {
        const log: string[] = []
        const code = await runVerify(m.cwd, m.verifyCommand, (c) => {
          log.push(c)
          event.sender.send('verify:chunk', c)
        })
        const ok = code === 0
        const summary = ok ? 'Verify passed' : `Verify failed (exit ${code})`
        showNotification(
          'LemonADE — agent session',
          summary,
          m.projectPath,
          'verify_after_agent',
          ok
        )
        broadcastInAppNotify({
          title: ok ? 'Verify passed' : 'Verify failed',
          body: summary,
          projectPath: m.projectPath,
          cwd: m.cwd,
          ptyId: id,
          source: 'verify_after',
          level: ok ? 'activity' : 'alert'
        })
        event.sender.send('lemonade:verify-after-agent', {
          projectPath: m.projectPath,
          cwd: m.cwd,
          ok,
          exitCode: code
        })
      } else if (m.agentSession) {
        showNotification(
          'LemonADE — agent session',
          `Shell exited (${exitCode ?? 'unknown'})`,
          m.projectPath,
          'agent_exit',
          (exitCode ?? 1) === 0
        )
        broadcastInAppNotify({
          title: 'Session ended',
          body: `Exit code ${exitCode ?? 'unknown'}`,
          projectPath: m.projectPath,
          cwd: m.cwd,
          ptyId: id,
          source: 'agent_exit',
          level: (exitCode ?? 1) === 0 ? 'activity' : 'attention'
        })
      }
    })
    return { id }
  })
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.halcyonyx.lemonade')
  }
  registerIpcHandlers()
  const ud = app.getPath('userData')
  if (!existsSync(ud)) mkdirSync(ud, { recursive: true })
  try {
    notifyServer = await startNotifyHttpServer({
      userDataDir: ud,
      onRequest: (p) => {
        showNotification(
          p.title,
          p.body,
          p.projectPath ?? '',
          'cli_notify',
          true
        )
        broadcastInAppNotify({
          title: p.title,
          body: p.body,
          projectPath: p.projectPath,
          cwd: p.cwd,
          ptyId: p.ptyId,
          source: 'cli',
          level: p.level
        })
      }
    })
  } catch (e) {
    console.error('[LemonADE] notify HTTP server failed', e)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  notifyServer?.stop()
  notifyServer = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
