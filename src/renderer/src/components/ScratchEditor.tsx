import { useCallback, useEffect, useState } from 'react'

type Props = {
  /** Directory files are confined to (typically cwd / worktree). */
  root: string
  /** Open this relative path when `nonce` changes (e.g. from file tree). */
  openTarget?: { relPath: string; nonce: number } | null
  onLog?: (line: string) => void
}

/**
 * Minimal text surface for editing files under `root`.
 * Swap this component for Monaco (or similar) later — keep props stable.
 */
export function ScratchEditor({ root, openTarget, onLog }: Props) {
  const [relPath, setRelPath] = useState('')
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const log = useCallback(
    (s: string) => {
      setStatus(s)
      onLog?.(s)
    },
    [onLog]
  )

  useEffect(() => {
    if (!openTarget?.relPath.trim() || !window.lemonade) return
    const p = openTarget.relPath.trim()
    let cancelled = false
    void (async () => {
      const res = await window.lemonade!.fsReadText(root, p)
      if (cancelled) return
      if (!res.ok) {
        const msg = res.error === 'notfound' ? 'File not found.' : 'Read failed.'
        setStatus(msg)
        onLog?.(msg)
        return
      }
      setRelPath(p)
      setText(res.text)
      setDirty(false)
      const okMsg = `Loaded ${p}`
      setStatus(okMsg)
      onLog?.(okMsg)
    })()
    return () => {
      cancelled = true
    }
  }, [root, openTarget?.relPath, openTarget?.nonce, onLog])

  const pick = useCallback(async () => {
    if (!window.lemonade) return
    const r = await window.lemonade.pickFile(root)
    if (!r) {
      log('Open cancelled.')
      return
    }
    if ('error' in r) {
      log(r.error === 'outsidecwd' ? 'File must be under cwd.' : 'Could not open file.')
      return
    }
    const res = await window.lemonade.fsReadText(root, r.relPath)
    if (!res.ok) {
      log(res.error === 'notfound' ? 'File not found.' : 'Read failed.')
      return
    }
    setRelPath(r.relPath)
    setText(res.text)
    setDirty(false)
    log(`Loaded ${r.relPath}`)
  }, [root, log])

  const save = useCallback(async () => {
    if (!window.lemonade || !relPath.trim()) {
      log('Set a path (Open…) before saving.')
      return
    }
    const res = await window.lemonade.fsWriteText(root, relPath.trim(), text)
    if (!res.ok) {
      log('Save failed.')
      return
    }
    setDirty(false)
    log(`Saved ${relPath}`)
  }, [root, relPath, text, log])

  return (
    <div className="scratch-editor">
      <p className="scratch-editor-banner">
        Placeholder editor (textarea). Swap this panel for Monaco or CodeMirror when you wire diff and LSP —
        file IPC is already scoped to cwd.
      </p>
      <div className="scratch-editor-toolbar">
        <input
          type="text"
          className="scratch-editor-path"
          placeholder="relative/path.ts"
          value={relPath}
          onChange={(e) => {
            setRelPath(e.target.value)
            setDirty(true)
          }}
          spellCheck={false}
        />
        <button type="button" className="btn btn-sm" onClick={() => void pick()}>
          Open…
        </button>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => void save()} disabled={!relPath.trim()}>
          Save
        </button>
      </div>
      {status ? <p className="scratch-editor-status">{status}</p> : null}
      <textarea
        className="scratch-editor-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        spellCheck={false}
        placeholder="Open a file or type a relative path, then edit here."
      />
    </div>
  )
}
