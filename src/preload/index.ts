import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

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

contextBridge.exposeInMainWorld('lemonade', {
  workspaceList: (): Promise<ProjectEntry[]> => ipcRenderer.invoke('workspace:list'),
  workspaceAdd: (dir: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('workspace:add', dir),
  workspaceRemove: (root: string): Promise<{ ok: true }> => ipcRenderer.invoke('workspace:remove', root),
  pickProject: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickProject'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  gitWorktrees: (root: string): Promise<{ worktrees: WorktreeEntry[] }> =>
    ipcRenderer.invoke('git:worktrees', root),

  previewSetUrl: (url: string | null): Promise<void> => ipcRenderer.invoke('preview:setUrl', url),
  previewSetBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
    ipcRenderer.invoke('preview:setBounds', bounds),

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
  }): Promise<{ id: string }> => ipcRenderer.invoke('pty:spawn', opts),
  ptyWrite: (id: string, data: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('pty:write', { id, data }),
  ptyResize: (id: string, cols: number, rows: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  ptyKill: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('pty:kill', id),

  verifyRun: (opts: { cwd: string; command: string }): Promise<{ code: number; ok: boolean }> =>
    ipcRenderer.invoke('verify:run', opts),

  onPtyOutput: (handler: (payload: { id: string; data: string }) => void): (() => void) => {
    const fn = (_: IpcRendererEvent, payload: { id: string; data: string }) => handler(payload)
    ipcRenderer.on('pty:output', fn)
    return () => ipcRenderer.removeListener('pty:output', fn)
  },
  onPtyExit: (handler: (payload: { id: string; exitCode: number }) => void): (() => void) => {
    const fn = (_: IpcRendererEvent, payload: { id: string; exitCode: number }) => handler(payload)
    ipcRenderer.on('pty:exit', fn)
    return () => ipcRenderer.removeListener('pty:exit', fn)
  },
  onVerifyChunk: (handler: (chunk: string) => void): (() => void) => {
    const fn = (_: IpcRendererEvent, chunk: string) => handler(chunk)
    ipcRenderer.on('verify:chunk', fn)
    return () => ipcRenderer.removeListener('verify:chunk', fn)
  },
  onNotificationClick: (
    handler: (payload: { projectPath: string; kind: string; ok: boolean }) => void
  ): (() => void) => {
    const fn = (
      _: IpcRendererEvent,
      payload: { projectPath: string; kind: string; ok: boolean }
    ) => handler(payload)
    ipcRenderer.on('lemonade:notification-click', fn)
    return () => ipcRenderer.removeListener('lemonade:notification-click', fn)
  },
  onVerifyAfterAgent: (
    handler: (payload: { projectPath: string; cwd: string; ok: boolean; exitCode: number }) => void
  ): (() => void) => {
    const fn = (
      _: IpcRendererEvent,
      payload: { projectPath: string; cwd: string; ok: boolean; exitCode: number }
    ) => handler(payload)
    ipcRenderer.on('lemonade:verify-after-agent', fn)
    return () => ipcRenderer.removeListener('lemonade:verify-after-agent', fn)
  },

  appPlatform: (): Promise<string> => ipcRenderer.invoke('app:platform'),
  notifyShow: (p: { title: string; body: string; projectPath?: string }): Promise<void> =>
    ipcRenderer.invoke('notify:show', p),
  notifyGetEndpoint: (): Promise<{ url: string; token: string } | null> =>
    ipcRenderer.invoke('notify:getEndpoint'),
  pickFile: (
    cwd: string
  ): Promise<{ relPath: string } | { error: 'outsidecwd' | 'baddir' } | null> =>
    ipcRenderer.invoke('dialog:pickFile', cwd),
  fsReadText: (
    root: string,
    relPath: string
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('fs:readText', { root, relPath }),
  fsWriteText: (
    root: string,
    relPath: string,
    text: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('fs:writeText', { root, relPath, text }),
  fsListDir: (
    root: string,
    relPath: string
  ): Promise<
    | { ok: true; entries: { name: string; isDir: boolean; relPath: string }[] }
    | { ok: false; error: string }
  > => ipcRenderer.invoke('fs:listDir', { root, relPath }),
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
  ): (() => void) => {
    const fn = (
      _: IpcRendererEvent,
      payload: {
        title: string
        body: string
        projectPath?: string
        cwd?: string
        ptyId?: string
        source: string
        level?: 'info' | 'activity' | 'attention' | 'alert'
      }
    ) => handler(payload)
    ipcRenderer.on('lemonade:in-app-notify', fn)
    return () => ipcRenderer.removeListener('lemonade:in-app-notify', fn)
  }
})
