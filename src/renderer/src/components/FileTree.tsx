import { useCallback, useEffect, useState } from 'react'

type Ent = { name: string; isDir: boolean; relPath: string }

type RowsProps = {
  root: string
  relDir: string
  depth: number
  selectedFile: string | null
  onOpenFile: (relPath: string) => void
}

function TreeRows({ root, relDir, depth, selectedFile, onOpenFile }: RowsProps) {
  const [entries, setEntries] = useState<Ent[] | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!window.lemonade) return
    let cancelled = false
    void window.lemonade.fsListDir(root, relDir).then((r) => {
      if (cancelled) return
      if (r.ok) setEntries(r.entries)
      else setEntries([])
    })
    return () => {
      cancelled = true
    }
  }, [root, relDir])

  const toggle = useCallback((relPath: string) => {
    setExpanded((prev) => ({ ...prev, [relPath]: !prev[relPath] }))
  }, [])

  if (entries === null) {
    return <div className="file-tree-loading">Loading…</div>
  }

  if (entries.length === 0) {
    return <div className="file-tree-empty">{relDir ? 'Empty folder' : 'Empty project root'}</div>
  }

  return (
    <ul className="file-tree-list" style={{ paddingLeft: depth === 0 ? 0 : 10 }}>
      {entries.map((e) => (
        <li key={e.relPath} className="file-tree-li">
          {e.isDir ? (
            <>
              <button type="button" className="file-tree-dir" onClick={() => toggle(e.relPath)}>
                <span className="file-tree-chevron">{expanded[e.relPath] ? '▼' : '▶'}</span>
                {e.name}
              </button>
              {expanded[e.relPath] ? (
                <TreeRows
                  root={root}
                  relDir={e.relPath}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onOpenFile={onOpenFile}
                />
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={`file-tree-file ${selectedFile === e.relPath ? 'selected' : ''}`}
              onClick={() => onOpenFile(e.relPath)}
            >
              {e.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

type Props = {
  root: string
  selectedFile: string | null
  onOpenFile: (relPath: string) => void
}

/** One column file browser; skips node_modules, .git, etc. (main process). */
export function FileTree({ root, selectedFile, onOpenFile }: Props) {
  if (!root) {
    return <p className="file-tree-empty">Pick a cwd first.</p>
  }
  return (
    <div className="file-tree">
      <TreeRows root={root} relDir="" depth={0} selectedFile={selectedFile} onOpenFile={onOpenFile} />
    </div>
  )
}
