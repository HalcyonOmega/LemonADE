/// <reference types="vite/client" />

export type ProjectConfig = {
  name: string
  previewUrl: string
  devPort?: number
  verifyCommand?: string
  agentCommand?: string
}

export type ProjectEntry = {
  root: string
  config: ProjectConfig
}

export type WorktreeEntry = {
  path: string
  head: string
  branch: string
  detached: boolean
}

export type LemonadeApi = {
  workspaceList: () => Promise<ProjectEntry[]>
  workspaceAdd: (dir: string) => Promise<{ ok: true } | { ok: false; error: string }>
  workspaceRemove: (root: string) => Promise<{ ok: true }>
  pickProject: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  gitWorktrees: (root: string) => Promise<{ worktrees: WorktreeEntry[] }>
  previewSetUrl: (url: string | null) => Promise<void>
  previewSetBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  ptySpawn: (opts: {
    projectPath: string
    cwd: string
    cols: number
    rows: number
    env?: Record<string, string>
    agentSession?: boolean
    verifyCommand?: string
    agentLabel?: string
    agentInteractiveCommand?: string
  }) => Promise<{ id: string }>
  ptyWrite: (id: string, data: string) => Promise<{ ok: boolean }>
  ptyResize: (id: string, cols: number, rows: number) => Promise<{ ok: boolean }>
  ptyKill: (id: string) => Promise<{ ok: boolean }>
  verifyRun: (opts: { cwd: string; command: string }) => Promise<{ code: number; ok: boolean }>
  onPtyOutput: (handler: (payload: { id: string; data: string }) => void) => () => void
  onPtyExit: (handler: (payload: { id: string; exitCode: number }) => void) => () => void
  onVerifyChunk: (handler: (chunk: string) => void) => () => void
  onNotificationClick: (
    handler: (payload: { projectPath: string; kind: string; ok: boolean }) => void
  ) => () => void
  onVerifyAfterAgent: (
    handler: (payload: { projectPath: string; cwd: string; ok: boolean; exitCode: number }) => void
  ) => () => void

  appPlatform: () => Promise<string>
  notifyShow: (p: {
    title: string
    body: string
    projectPath?: string
    cwd?: string
    ptyId?: string
    level?: 'info' | 'activity' | 'attention' | 'alert'
  }) => Promise<void>
  notifyGetEndpoint: () => Promise<{ url: string; token: string } | null>
  pickFile: (
    cwd: string
  ) => Promise<{ relPath: string } | { error: 'outsidecwd' | 'baddir' } | null>
  fsReadText: (
    root: string,
    relPath: string
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  fsWriteText: (
    root: string,
    relPath: string,
    text: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  fsListDir: (
    root: string,
    relPath: string
  ) => Promise<
    | { ok: true; entries: { name: string; isDir: boolean; relPath: string }[] }
    | { ok: false; error: string }
  >
  onInAppNotify: (
    handler: (payload: {
      title: string
      body: string
      projectPath?: string
      cwd?: string
      ptyId?: string
      source: string
      level?: 'info' | 'activity' | 'attention' | 'alert'
    }) => void
  ) => () => void
}

declare global {
  interface Window {
    lemonade?: LemonadeApi
  }
}

export {}
