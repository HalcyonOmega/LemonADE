import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ProjectConfig, ProjectEntry, WorktreeEntry } from './vite-env'
import { FileTree } from './components/FileTree'
import { MosaicWorkspace } from './components/MosaicWorkspace'
import { NotifyPill } from './components/NotifyPill'
import { renderMosaicTileBody } from './mosaic-bodies'
import {
  type TileKind,
  DEFAULT_MOSAIC,
  MOSAIC_STORAGE_KEY,
  type MosaicPersisted,
  loadMosaicPersisted,
  saveMosaicPersisted,
  addTileToMosaic,
  defaultColFlex,
  moveTileBetween,
  TILE_LABELS
} from './mosaic-layout'
import {
  bumpPillsFromNotify,
  clearPillKey,
  loadPillMap,
  pillKeyCwd,
  pillKeyProject,
  pillKeyPty,
  savePillMap,
  type InAppNotifyExtended
} from './notify-pills'
import './App.css'

const BUF_CAP = 200_000

function envForConfig(config: ProjectConfig): Record<string, string> | undefined {
  if (!config.devPort) return undefined
  const p = String(config.devPort)
  return { PORT: p, VITE_PORT: p, NEXT_PORT: p }
}

function hasLemonadeApi(): boolean {
  return typeof window !== 'undefined' && typeof window.lemonade !== 'undefined'
}

type AgentRun = {
  uiId: string
  label: string
  ptyId: string
  status: 'running' | 'exited'
}

type ToastItem = { id: string; title: string; body: string; source: string }

export default function App() {
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [cwd, setCwd] = useState<string>('')
  const [activity, setActivity] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [agents, setAgents] = useState<AgentRun[]>([])
  const [focusedPtyId, setFocusedPtyId] = useState<string | null>(null)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [agentChatDraft, setAgentChatDraft] = useState('')
  const [notifyEp, setNotifyEp] = useState<{ url: string; token: string } | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const platformRef = useRef<string>('darwin')

  const mosaicOuterRef = useRef<HTMLDivElement>(null)
  const rowInnerRefs = useRef<(HTMLDivElement | null)[]>([])
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewColumnRef = useRef<HTMLDivElement>(null)
  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const buffersRef = useRef<Map<string, string>>(new Map())
  const shellPtyIdRef = useRef<string | null>(null)
  const focusedPtyIdRef = useRef<string | null>(null)
  const agentsRef = useRef<AgentRun[]>([])
  focusedPtyIdRef.current = focusedPtyId
  agentsRef.current = agents

  const active = projects.find((p) => p.root === activeRoot) ?? null
  const config = active?.config
  const previewUrlTrimmed = config?.previewUrl?.trim() ?? ''
  const hasPreviewUrl = Boolean(previewUrlTrimmed)
  const hasAgentTool = Boolean(config?.agentCommand?.trim())
  const [treeSelectedFile, setTreeSelectedFile] = useState<string | null>(null)
  const [editorOpenTarget, setEditorOpenTarget] = useState<{ relPath: string; nonce: number } | null>(null)
  const [layout, setLayout] = useState<MosaicPersisted>(() => loadMosaicPersisted())
  const [nextSplitAxis, setNextSplitAxis] = useState<'horizontal' | 'vertical'>('horizontal')
  const [tileToAdd, setTileToAdd] = useState<TileKind>('activity')
  const [focusedTileKind, setFocusedTileKind] = useState<TileKind | null>('terminal')
  const [focusedRowIndex, setFocusedRowIndex] = useState(1)
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number; root: string } | null>(null)
  const [notifyPills, setNotifyPills] = useState(loadPillMap)

  const mosaicRows = layout.rows
  const colFlex = layout.colFlex
  const rowHeightsPx = layout.rowHeightsPx

  const appendActivity = useCallback((line: string) => {
    setActivity((a) => (a + line).slice(-48000))
  }, [])

  const onEditorLog = useCallback(
    (s: string) => appendActivity(`\n[editor] ${s}\n`),
    [appendActivity]
  )

  const refreshProjects = useCallback(async () => {
    if (!hasLemonadeApi()) return
    try {
      const list = await window.lemonade!.workspaceList()
      setProjects(list)
      setActiveRoot((cur) => {
        if (cur && list.some((p) => p.root === cur)) return cur
        return list[0]?.root ?? null
      })
    } catch (e) {
      setProjects([])
      setActivity((a) => `${a}\n[workspace error] ${String(e)}\n`)
    }
  }, [])

  useEffect(() => {
    savePillMap(notifyPills)
  }, [notifyPills])

  useEffect(() => {
    if (!hasLemonadeApi()) return
    void refreshProjects()
    const offOut = window.lemonade!.onPtyOutput(({ id, data }) => {
      const m = buffersRef.current
      const next = ((m.get(id) ?? '') + data).slice(-BUF_CAP)
      m.set(id, next)
      if (id === focusedPtyIdRef.current && termRef.current) termRef.current.write(data)
    })
    const offExit = window.lemonade!.onPtyExit(({ id, exitCode }) => {
      appendActivity(`\n[pty ${id} exited: ${exitCode}]\n`)
      if (shellPtyIdRef.current === id) shellPtyIdRef.current = null
      setAgents((prev) =>
        prev.map((a) => (a.ptyId === id ? { ...a, status: 'exited' as const } : a))
      )
      if (focusedPtyIdRef.current === id) {
        setFocusedPtyId(null)
        termRef.current?.clear()
      }
    })
    const offChunk = window.lemonade!.onVerifyChunk((c) => appendActivity(c))
    const offNotify = window.lemonade!.onNotificationClick((p) => {
      if (p.projectPath) {
        setNotifyPills((prev) => clearPillKey(prev, pillKeyProject(p.projectPath)))
      }
      setActiveRoot(p.projectPath)
    })
    const offAfterAgent = window.lemonade!.onVerifyAfterAgent((p) => {
      appendActivity(`\n--- verify after agent: ${p.ok ? 'OK' : 'FAIL'} (${p.exitCode}) ---\n`)
      setVerifyStatus(p.ok ? 'ok' : 'fail')
    })
    const offInApp = window.lemonade!.onInAppNotify((p) => {
      setToasts((prev) =>
        [{ id: crypto.randomUUID(), title: p.title, body: p.body, source: p.source }, ...prev].slice(0, 6)
      )
      setNotifyPills((prev) => bumpPillsFromNotify(prev, p as InAppNotifyExtended))
      appendActivity(`\n[notify · ${p.source}] ${p.title}: ${p.body}\n`)
    })
    void window.lemonade!.appPlatform().then((plat) => {
      platformRef.current = plat
    })
    return () => {
      offOut()
      offExit()
      offChunk()
      offNotify()
      offAfterAgent()
      offInApp()
    }
  }, [refreshProjects, appendActivity])

  useEffect(() => {
    if (!hasLemonadeApi() || !active?.root) {
      setNotifyEp(null)
      return
    }
    void window.lemonade!.notifyGetEndpoint().then(setNotifyEp)
  }, [active?.root])

  useEffect(() => {
    let cancelled = false
    if (!active?.root || !hasLemonadeApi()) {
      setWorktrees([])
      setCwd('')
      return
    }
    void (async () => {
      const { worktrees: wt } = await window.lemonade!.gitWorktrees(active.root)
      if (cancelled) return
      setWorktrees(wt)
      setCwd(active.root)
    })()
    return () => {
      cancelled = true
    }
  }, [active?.root])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let io: IntersectionObserver | null = null
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const el = previewColumnRef.current
      if (!el) return
      io = new IntersectionObserver(
        ([e]) => setPreviewVisible(e?.isIntersecting ?? false),
        { root: mosaicOuterRef.current ?? undefined, threshold: 0.35 }
      )
      io.observe(el)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [active?.root, layout.rows])

  useEffect(() => {
    setTreeSelectedFile(null)
    setEditorOpenTarget(null)
  }, [cwd])

  const killShellIfAny = useCallback(async () => {
    const id = shellPtyIdRef.current
    if (id) {
      await window.lemonade!.ptyKill(id)
      shellPtyIdRef.current = null
      buffersRef.current.delete(id)
      if (focusedPtyIdRef.current === id) {
        setFocusedPtyId(null)
        termRef.current?.clear()
      }
    }
  }, [])

  useEffect(() => {
    if (!hasLemonadeApi()) return
    for (const a of agentsRef.current) {
      if (a.status === 'running') void window.lemonade!.ptyKill(a.ptyId)
    }
    buffersRef.current.clear()
    setAgents([])
    setFocusedPtyId(null)
    shellPtyIdRef.current = null
  }, [activeRoot])

  useEffect(() => {
    if (!hasLemonadeApi() || !active?.root) return
    const host = termHostRef.current
    if (!host) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '\"IBM Plex Mono\", Consolas, ui-monospace, monospace',
      theme: { background: '#080a0e', foreground: '#e8ecf4' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    term.onData((d) => {
      const id = focusedPtyIdRef.current
      if (id) void window.lemonade!.ptyWrite(id, d)
    })
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(host)
    return () => {
      void killShellIfAny()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [active?.root, killShellIfAny])

  const replayTerm = useCallback((ptyId: string | null) => {
    const term = termRef.current
    if (!term) return
    term.clear()
    if (!ptyId) return
    term.write(buffersRef.current.get(ptyId) ?? '')
  }, [])

  useEffect(() => {
    replayTerm(focusedPtyId)
  }, [focusedPtyId, replayTerm])

  const spawnShell = useCallback(async () => {
    if (!hasLemonadeApi() || !active || !cwd || !config) return
    await killShellIfAny()
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    fit.fit()
    const cols = Math.max(term.cols, 40)
    const rows = Math.max(term.rows, 12)
    try {
      const { id } = await window.lemonade!.ptySpawn({
        projectPath: active.root,
        cwd,
        cols,
        rows,
        env: envForConfig(config),
        agentSession: false
      })
      shellPtyIdRef.current = id
      buffersRef.current.set(id, '')
      setFocusedPtyId(id)
      appendActivity('\n--- shell ---\n')
    } catch (e) {
      appendActivity(`\n[shell spawn failed] ${String(e)}\n`)
    }
  }, [active, cwd, config, killShellIfAny, appendActivity])

  const spawnAgentSession = useCallback(
    async (mode: 'useSettings' | 'shellOnly') => {
      if (!hasLemonadeApi() || !active || !cwd || !config) return
      const fit = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      fit.fit()
      const cols = Math.max(term.cols, 40)
      const rows = Math.max(term.rows, 12)
      const uiId = crypto.randomUUID()
      const label = `Agent ${uiId.slice(0, 8)}`
      const agentInteractiveCommand =
        mode === 'useSettings' && config.agentCommand?.trim() ? config.agentCommand.trim() : undefined
      try {
        const { id } = await window.lemonade!.ptySpawn({
          projectPath: active.root,
          cwd,
          cols,
          rows,
          env: envForConfig(config),
          agentSession: true,
          verifyCommand: config.verifyCommand,
          agentLabel: label,
          agentInteractiveCommand
        })
        buffersRef.current.set(id, '')
        setAgents((prev) => [...prev, { uiId, label, ptyId: id, status: 'running' }])
        setFocusedPtyId(id)
        const sub =
          agentInteractiveCommand != null
            ? ` (${agentInteractiveCommand.length > 56 ? `${agentInteractiveCommand.slice(0, 56)}…` : agentInteractiveCommand})`
            : ' (login shell)'
        appendActivity(`\n--- ${label} started${sub} ---\n`)
      } catch (e) {
        appendActivity(`\n[agent spawn failed] ${String(e)}\n`)
      }
    },
    [active, cwd, config, appendActivity]
  )

  const ackAndFocusAgentPty = useCallback((ptyId: string) => {
    setNotifyPills((p) => clearPillKey(p, pillKeyPty(ptyId)))
    setFocusedPtyId(ptyId)
  }, [])

  const sendAgentChat = useCallback(async () => {
    if (!hasLemonadeApi()) return
    const id = focusedPtyIdRef.current
    const line = agentChatDraft.trim()
    if (!id || !line) return
    const nl = platformRef.current === 'win32' ? '\r\n' : '\n'
    const r = await window.lemonade!.ptyWrite(id, line + nl)
    if (r.ok) {
      appendActivity(`\n[→ session] ${line}\n`)
      setAgentChatDraft('')
    } else {
      appendActivity('\n[chat] PTY write failed — focus a running shell or agent.\n')
    }
  }, [agentChatDraft, appendActivity])

  const copyNotifyHelp = useCallback(async () => {
    if (!notifyEp || !active) return
    const payload = {
      title: 'From script',
      body: 'Done',
      projectPath: active.root,
      cwd: cwd || active.root,
      level: 'activity' as const
    }
    const body = JSON.stringify(payload)
    const curl = `curl -sS -X POST ${JSON.stringify(notifyEp.url)} -H ${JSON.stringify(`Authorization: Bearer ${notifyEp.token}`)} -H "Content-Type: application/json" -d ${JSON.stringify(body)}`
    const ptyLine = `LEMONADE_NOTIFY_JSON:${JSON.stringify({ title: 'Step', body: 'Complete', level: 'activity' })}`
    const text = [
      '# HTTP (127.0.0.1 only, Bearer token):',
      curl,
      '',
      '# Or print this full line in a PTY (stdout still streams normally):',
      ptyLine,
      '',
      '# PTY env: LEMONADE_NOTIFY_PORT, LEMONADE_NOTIFY_TOKEN'
    ].join('\n')
    await navigator.clipboard.writeText(text)
    appendActivity('\nCopied notify examples to clipboard.\n')
  }, [notifyEp, active, cwd, appendActivity])

  const sendTestNotify = useCallback(async () => {
    if (!hasLemonadeApi() || !active) return
    await window.lemonade!.notifyShow({
      title: 'LemonADE',
      body: 'Test notification from the UI.',
      projectPath: active.root,
      cwd: cwd || undefined,
      level: 'info'
    })
  }, [active, cwd])

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  useEffect(() => {
    if (!hasLemonadeApi() || !active?.root || !cwd || !config) return
    if (!termRef.current || !fitRef.current) return
    let cancelled = false
    void (async () => {
      try {
        await spawnShell()
      } catch (e) {
        if (!cancelled) appendActivity(`\n[auto shell failed] ${String(e)}\n`)
      }
    })()
    return () => {
      cancelled = true
      void killShellIfAny()
    }
  }, [active?.root, cwd, config, spawnShell, killShellIfAny, appendActivity])

  useLayoutEffect(() => {
    if (!hasLemonadeApi()) return
    const el = previewHostRef.current
    const url = config?.previewUrl?.trim()
    if (!el || !url || !previewVisible) {
      void window.lemonade!.previewSetUrl(null)
      return
    }
    const send = (): void => {
      const r = el.getBoundingClientRect()
      void window.lemonade!.previewSetBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
    void window.lemonade!.previewSetUrl(url)
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      if (hasLemonadeApi()) void window.lemonade!.previewSetUrl(null)
    }
  }, [config?.previewUrl, activeRoot, previewVisible])

  useEffect(() => {
    fitRef.current?.fit()
  }, [focusedPtyId, activeRoot])

  useEffect(() => {
    saveMosaicPersisted(layout)
  }, [layout])

  useEffect(() => {
    rowInnerRefs.current = rowInnerRefs.current.slice(0, mosaicRows.length)
  }, [mosaicRows.length])

  useEffect(() => {
    if (!active?.root) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
        return
      if ((t as HTMLElement).closest?.('[data-xterm-wrap]')) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const outer = mosaicOuterRef.current
      const rowEl = rowInnerRefs.current[focusedRowIndex]
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        outer?.scrollBy({ top: -Math.max(outer.clientHeight * 0.82, 200), behavior: 'smooth' })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        outer?.scrollBy({ top: Math.max(outer.clientHeight * 0.82, 200), behavior: 'smooth' })
      } else if (e.key === 'ArrowLeft' && rowEl) {
        e.preventDefault()
        rowEl.scrollBy({ left: -Math.max(rowEl.clientWidth * 0.82, 200), behavior: 'smooth' })
      } else if (e.key === 'ArrowRight' && rowEl) {
        e.preventDefault()
        rowEl.scrollBy({ left: Math.max(rowEl.clientWidth * 0.82, 200), behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active?.root, focusedRowIndex])

  const addMosaicTile = useCallback(() => {
    setLayout((L) => {
      const r = addTileToMosaic(L.rows, L.colFlex, {
        kind: tileToAdd,
        axis: nextSplitAxis,
        rowIndex: Math.min(focusedRowIndex, Math.max(0, L.rows.length - 1)),
        anchorTile: focusedTileKind
      })
      return { ...L, rows: r.rows, colFlex: r.colFlex }
    })
  }, [tileToAdd, nextSplitAxis, focusedRowIndex, focusedTileKind])

  const resetMosaicLayout = useCallback(() => {
    setLayout({
      rows: DEFAULT_MOSAIC,
      colFlex: defaultColFlex(DEFAULT_MOSAIC),
      rowHeightsPx: null
    })
    try {
      sessionStorage.removeItem(MOSAIC_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const focusTileHeader = useCallback((rowIndex: number, kind: TileKind) => {
    setFocusedRowIndex(rowIndex)
    setFocusedTileKind(kind)
  }, [])

  const onMosaicMoveTile = useCallback((fromRi: number, fromTi: number, toRi: number, insertAt: number) => {
    setLayout((L) => {
      const { rows, colFlex: cf } = moveTileBetween(L.rows, L.colFlex, fromRi, fromTi, toRi, insertAt)
      return { ...L, rows, colFlex: cf }
    })
  }, [])

  useEffect(() => {
    setFocusedRowIndex((i) => Math.min(i, Math.max(0, layout.rows.length - 1)))
  }, [layout.rows.length])

  useEffect(() => {
    if (!workspaceMenu) return
    const close = (): void => setWorkspaceMenu(null)
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', close)
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('mousedown', close)
    }
  }, [workspaceMenu])

  const runVerify = async (): Promise<void> => {
    if (!hasLemonadeApi() || !active || !cwd) return
    const cmd = config?.verifyCommand?.trim()
    if (!cmd) {
      appendActivity('\n(no verifyCommand — set in .lemonade/settings.json)\n')
      return
    }
    setVerifyStatus('running')
    appendActivity(`\n--- verify: ${cmd} ---\n`)
    const r = await window.lemonade!.verifyRun({ cwd, command: cmd })
    setVerifyStatus(r.ok ? 'ok' : 'fail')
    appendActivity(`\n--- verify exit ${r.code} ---\n`)
  }

  const addProject = async (): Promise<void> => {
    if (!hasLemonadeApi()) return
    const dir = await window.lemonade!.pickProject()
    if (!dir) return
    const res = await window.lemonade!.workspaceAdd(dir)
    if (!res.ok) {
      appendActivity(`\nAdd failed: ${res.error}\n`)
      return
    }
    await refreshProjects()
  }

  const removeWorkspaceByRoot = async (root: string): Promise<void> => {
    if (!hasLemonadeApi()) return
    if (activeRoot === root) {
      await killShellIfAny()
      for (const a of agentsRef.current) {
        if (a.status === 'running') await window.lemonade!.ptyKill(a.ptyId)
      }
      setAgents([])
      setFocusedPtyId(null)
    }
    await window.lemonade!.workspaceRemove(root)
    await refreshProjects()
  }

  if (!hasLemonadeApi()) {
    return (
      <div className="preload-fail">
        <h1>LemonADE</h1>
        <p>
          Preload missing <code>window.lemonade</code>. Run <code>bun run dev</code> from the repo root.
        </p>
      </div>
    )
  }

  const worktreeRailRows =
    active && (worktrees.length > 0
      ? worktrees
      : [{ path: active.root, branch: 'workspace', head: '', detached: false }])

  const allKinds: TileKind[] = ['preview', 'agents', 'terminal', 'editor', 'activity']

  return (
    <div className="app">
      <aside className="sidebar sidebar--primary" aria-label="Workspaces">
        <div className="sidebar-brand">
          <h1>LemonADE</h1>
        </div>
        <div className="project-list project-list--primary">
          {projects.map((p) => (
            <button
              key={p.root}
              type="button"
              className={`project-item ${p.root === activeRoot ? 'active' : ''}`}
              onClick={() => {
                setNotifyPills((prev) => clearPillKey(prev, pillKeyProject(p.root)))
                setActiveRoot(p.root)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setWorkspaceMenu({ x: e.clientX, y: e.clientY, root: p.root })
              }}
            >
              <span className="project-item-title-row">
                <span className="project-item-name">{p.config.name}</span>
                <NotifyPill pill={notifyPills[pillKeyProject(p.root)]} />
              </span>
              <small>{p.root}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-actions">
          <button type="button" className="btn btn-primary" onClick={() => void addProject()}>
            Open folder…
          </button>
        </div>
      </aside>

      {active ? (
        <aside className="sidebar sidebar--rail" aria-label="Worktrees">
          <div className="rail-list">
            {worktreeRailRows!.map((w) => (
              <button
                key={w.path}
                type="button"
                className={`rail-item ${cwd === w.path ? 'active' : ''}`}
                onClick={() => {
                  setNotifyPills((prev) => clearPillKey(prev, pillKeyCwd(w.path)))
                  setCwd(w.path)
                }}
              >
                <span className="rail-item-head">
                  <span className="rail-branch">{w.detached ? '(detached)' : w.branch || '—'}</span>
                  <NotifyPill pill={notifyPills[pillKeyCwd(w.path)]} />
                </span>
                <span className="rail-path" title={w.path}>
                  {w.path}
                </span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <main className="main">
        {!active ? (
          <div className="empty-main">
            <p>Select a workspace.</p>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="toolbar-group toolbar-group--actions">
                <div className="toolbar-actions">
                  <button type="button" className="btn btn-accent" onClick={() => void spawnShell()}>
                    Shell
                  </button>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => void spawnAgentSession('useSettings')}
                    title={
                      hasAgentTool
                        ? `Runs agentCommand: ${config?.agentCommand?.trim()}`
                        : 'Login shell with agent session hooks'
                    }
                  >
                    New agent
                  </button>
                  {hasAgentTool ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void spawnAgentSession('shellOnly')}
                      title="Login shell only (ignore agentCommand)"
                    >
                      Agent shell
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={() => void runVerify()}>
                    Verify
                    {verifyStatus !== 'idle' ? (
                      <span
                        className={`toolbar-verify-dot ${verifyStatus === 'ok' ? 'ok' : verifyStatus === 'fail' ? 'fail' : 'run'}`}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                  {hasPreviewUrl ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void window.lemonade!.openExternal(previewUrlTrimmed)}
                    >
                      Open preview in browser
                    </button>
                  ) : null}
                  {notifyEp ? (
                    <button type="button" className="btn" onClick={() => void copyNotifyHelp()}>
                      Copy notify examples
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={() => void sendTestNotify()}>
                    Test notify
                  </button>
                </div>
              </div>
            </div>

            <div className="mosaic-controls">
              <div className="mosaic-controls-split" role="group" aria-label="Where to add the next tile">
                <button
                  type="button"
                  className={`split-toggle ${nextSplitAxis === 'horizontal' ? 'is-on' : ''}`}
                  onClick={() => setNextSplitAxis('horizontal')}
                  title="Insert to the right of the focused tile in the same row"
                >
                  In row →
                </button>
                <button
                  type="button"
                  className={`split-toggle ${nextSplitAxis === 'vertical' ? 'is-on' : ''}`}
                  onClick={() => setNextSplitAxis('vertical')}
                  title="Insert as a new row below the focused row"
                >
                  New row ↓
                </button>
              </div>
              <label className="mosaic-controls-kind">
                <span className="mosaic-controls-label">Add</span>
                <select
                  className="mosaic-kind-select"
                  value={tileToAdd}
                  onChange={(e) => setTileToAdd(e.target.value as TileKind)}
                >
                  {allKinds.map((k) => (
                    <option key={k} value={k}>
                      {TILE_LABELS[k].title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-accent btn-sm" onClick={addMosaicTile}>
                Add tile
              </button>
              <button type="button" className="btn btn-sm" onClick={resetMosaicLayout}>
                Reset layout
              </button>
            </div>

            <div className="mosaic-wrap">
              <MosaicWorkspace
                rows={mosaicRows}
                colFlex={colFlex}
                rowHeightsPx={rowHeightsPx}
                mosaicOuterRef={mosaicOuterRef}
                rowInnerRefs={rowInnerRefs}
                previewColumnRef={previewColumnRef}
                focusedRowIndex={focusedRowIndex}
                focusedTileKind={focusedTileKind}
                onFocusHeader={focusTileHeader}
                onMoveTile={onMosaicMoveTile}
                onColFlexChange={(next) => setLayout((L) => ({ ...L, colFlex: next }))}
                onRowHeightsPxChange={(next) => setLayout((L) => ({ ...L, rowHeightsPx: next }))}
                renderTileBody={(kind) =>
                  renderMosaicTileBody(kind, {
                    hasPreviewUrl,
                    previewHostRef,
                    agentChatDraft,
                    setAgentChatDraft,
                    sendAgentChat,
                    agents,
                    focusedPtyId,
                    ackAndFocusAgentPty,
                    agentPill: (id) => notifyPills[pillKeyPty(id)],
                    spawnAgentSession,
                    cwd,
                    termHostRef,
                    spawnShell,
                    editorOpenTarget,
                    onEditorLog,
                    activity
                  })
                }
              />
            </div>
          </>
        )}
      </main>

      {active ? (
        <aside className="sidebar sidebar--files" aria-label="Files">
          <div className="files-sidebar-inner">
            {cwd ? (
              <FileTree
                root={cwd}
                selectedFile={treeSelectedFile}
                onOpenFile={(rel) => {
                  setTreeSelectedFile(rel)
                  setEditorOpenTarget({ relPath: rel, nonce: Date.now() })
                }}
              />
            ) : null}
          </div>
        </aside>
      ) : null}

      {workspaceMenu ? (
        <div
          className="workspace-ctx-menu"
          style={{ left: workspaceMenu.x, top: workspaceMenu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="workspace-ctx-item workspace-ctx-item--danger"
            role="menuitem"
            onClick={() => {
              const root = workspaceMenu.root
              setWorkspaceMenu(null)
              if (window.confirm('Remove this workspace from LemonADE?')) void removeWorkspaceByRoot(root)
            }}
          >
            Remove workspace…
          </button>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="toast-stack" role="status">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              className="toast"
              onClick={() => dismissToast(t.id)}
              title="Dismiss"
            >
              <span className="toast-source">{t.source}</span>
              <span className="toast-title">{t.title}</span>
              <span className="toast-body">{t.body}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
