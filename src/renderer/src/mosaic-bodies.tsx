import type { ReactNode, RefObject } from 'react'
import type { PillBucket } from './notify-pills'
import type { TileKind } from './mosaic-layout'
import { NotifyPill } from './components/NotifyPill'
import { ScratchEditor } from './components/ScratchEditor'

export type MosaicBodiesDeps = {
  hasPreviewUrl: boolean
  previewHostRef: RefObject<HTMLDivElement | null>
  agentChatDraft: string
  setAgentChatDraft: (s: string) => void
  sendAgentChat: () => void
  agents: { uiId: string; label: string; ptyId: string; status: 'running' | 'exited' }[]
  focusedPtyId: string | null
  /** Clears agent pill then focuses PTY */
  ackAndFocusAgentPty: (id: string) => void
  agentPill: (ptyId: string) => PillBucket | undefined
  spawnAgentSession: (m: 'useSettings' | 'shellOnly') => void
  cwd: string
  termHostRef: RefObject<HTMLDivElement | null>
  spawnShell: () => void
  editorOpenTarget: { relPath: string; nonce: number } | null
  onEditorLog: (s: string) => void
  activity: string
}

export function renderMosaicTileBody(kind: TileKind, d: MosaicBodiesDeps): ReactNode {
  switch (kind) {
    case 'preview':
      return (
        <div
          ref={d.previewHostRef}
          className={`preview-host preview-host--tile ${!d.hasPreviewUrl ? 'empty' : ''}`}
        >
          {!d.hasPreviewUrl ? (
            <div className="column-empty column-empty--preview">
              <p className="column-empty-title">No preview URL</p>
            </div>
          ) : null}
        </div>
      )
    case 'agents':
      return (
        <div className="agent-column-body agent-column-body--tile">
          <div className="agent-chat">
            <textarea
              className="agent-chat-input"
              value={d.agentChatDraft}
              onChange={(e) => d.setAgentChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void d.sendAgentChat()
                }
              }}
              placeholder={d.focusedPtyId ? 'Message focused session…' : 'Focus a session…'}
              rows={3}
              spellCheck={false}
            />
            <button type="button" className="btn btn-accent btn-sm" onClick={() => void d.sendAgentChat()}>
              Send
            </button>
          </div>
          {d.agents.length === 0 ? (
            <div className="column-empty column-empty--agents">
              <button
                type="button"
                className="btn btn-accent btn-cta"
                onClick={() => void d.spawnAgentSession('useSettings')}
              >
                New agent
              </button>
            </div>
          ) : null}
          <div className="agent-list">
            {d.agents.map((a) => (
              <div
                key={a.uiId}
                className={`agent-row ${d.focusedPtyId === a.ptyId ? 'focused' : ''} ${a.status === 'exited' ? 'exited' : ''}`}
              >
                <span className="agent-row-label">
                  {a.label} <small style={{ color: 'var(--muted)' }}>{a.status}</small>
                  <NotifyPill pill={d.agentPill(a.ptyId)} />
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={a.status !== 'running'}
                  onClick={() => d.ackAndFocusAgentPty(a.ptyId)}
                >
                  Focus
                </button>
              </div>
            ))}
          </div>
        </div>
      )
    case 'terminal':
      return (
        <div className="terminal-wrap" data-xterm-wrap>
          <div ref={d.termHostRef} className="terminal-host" />
          {d.focusedPtyId ? null : (
            <div className="terminal-empty column-empty column-empty--terminal">
              <div className="terminal-empty-actions">
                <button type="button" className="btn btn-accent btn-cta" onClick={() => void d.spawnShell()}>
                  Shell
                </button>
                <button
                  type="button"
                  className="btn btn-cta"
                  onClick={() => void d.spawnAgentSession('useSettings')}
                >
                  Agent
                </button>
              </div>
            </div>
          )}
        </div>
      )
    case 'editor':
      return (
        <div className="editor-column-body editor-column-body--tile">
          {d.cwd ? (
            <ScratchEditor root={d.cwd} openTarget={d.editorOpenTarget} onLog={d.onEditorLog} />
          ) : (
            <p className="editor-cwd-wait">…</p>
          )}
        </div>
      )
    case 'activity':
      return (
        <div className="activity-body activity-body--tile">
          <pre>{d.activity || '—'}</pre>
        </div>
      )
    default:
      return null
  }
}
