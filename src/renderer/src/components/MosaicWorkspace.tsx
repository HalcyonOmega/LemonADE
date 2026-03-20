import type { MutableRefObject, ReactNode, RefObject } from 'react'
import { Fragment, useCallback, useRef, useState } from 'react'
import type { MosaicRow, TileKind } from '../mosaic-layout'
import { TILE_LABELS } from '../mosaic-layout'

const DRAG_MIME = 'application/x-lemonade-tile'

export type DragTilePayload = { fromRi: number; fromTi: number }

type Props = {
  rows: MosaicRow[]
  colFlex: number[][]
  rowHeightsPx: number[] | null
  mosaicOuterRef: RefObject<HTMLDivElement | null>
  rowInnerRefs: MutableRefObject<(HTMLDivElement | null)[]>
  previewColumnRef: RefObject<HTMLDivElement | null>
  focusedRowIndex: number
  focusedTileKind: TileKind | null
  onFocusHeader: (rowIndex: number, kind: TileKind) => void
  onMoveTile: (fromRi: number, fromTi: number, toRi: number, insertAt: number) => void
  onColFlexChange: (next: number[][]) => void
  onRowHeightsPxChange: (next: number[] | null) => void
  renderTileBody: (kind: TileKind, rowIndex: number, tileIndex: number) => ReactNode
}

function parseDragPayload(dt: DataTransfer): DragTilePayload | null {
  try {
    const raw = dt.getData(DRAG_MIME)
    if (!raw) return null
    const j = JSON.parse(raw) as { fromRi?: number; fromTi?: number }
    if (typeof j.fromRi !== 'number' || typeof j.fromTi !== 'number') return null
    return { fromRi: j.fromRi, fromTi: j.fromTi }
  } catch {
    return null
  }
}

function insertIndexFromClientX(rowEl: HTMLElement, clientX: number): number {
  const tiles = rowEl.querySelectorAll(':scope > .mosaic-tile')
  if (tiles.length === 0) return 0
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i]!.getBoundingClientRect()
    const mid = (r.left + r.right) / 2
    if (clientX < mid) return i
  }
  return tiles.length
}

export function MosaicWorkspace({
  rows,
  colFlex,
  rowHeightsPx,
  mosaicOuterRef,
  rowInnerRefs,
  previewColumnRef,
  focusedRowIndex,
  focusedTileKind,
  onFocusHeader,
  onMoveTile,
  onColFlexChange,
  onRowHeightsPxChange,
  renderTileBody
}: Props) {
  const [dropHint, setDropHint] = useState<{ ri: number; insertAt: number } | null>(null)
  const dragPayloadRef = useRef<DragTilePayload | null>(null)

  const onDragStart = useCallback((e: React.DragEvent, fromRi: number, fromTi: number) => {
    const p: DragTilePayload = { fromRi, fromTi }
    dragPayloadRef.current = p
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(p))
    e.dataTransfer.effectAllowed = 'move'
    const img = new Image()
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    e.dataTransfer.setDragImage(img, 0, 0)
  }, [])

  const onDragEnd = useCallback(() => {
    dragPayloadRef.current = null
    setDropHint(null)
  }, [])

  const onRowDragOver = useCallback(
    (e: React.DragEvent, ri: number) => {
      if (!Array.from(e.dataTransfer.types).includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const inner = rowInnerRefs.current[ri]
      if (!inner) return
      const insertAt = insertIndexFromClientX(inner, e.clientX)
      setDropHint((h) => (h?.ri === ri && h.insertAt === insertAt ? h : { ri, insertAt }))
    },
    [rowInnerRefs]
  )

  const onRowDrop = useCallback(
    (e: React.DragEvent, toRi: number) => {
      e.preventDefault()
      const p = parseDragPayload(e.dataTransfer) ?? dragPayloadRef.current
      setDropHint(null)
      dragPayloadRef.current = null
      if (!p) return
      const inner = rowInnerRefs.current[toRi]
      if (!inner) return
      const insertAt = insertIndexFromClientX(inner, e.clientX)
      onMoveTile(p.fromRi, p.fromTi, toRi, insertAt)
    },
    [onMoveTile, rowInnerRefs]
  )

  const startColResize = useCallback(
    (ri: number, afterTi: number, e: React.MouseEvent) => {
      e.preventDefault()
      const flexRow = [...(colFlex[ri] ?? [])]
      const a = flexRow[afterTi] ?? 1
      const b = flexRow[afterTi + 1] ?? 1
      const startX = e.clientX
      const startSum = a + b
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const scale = 0.01
        let na = a + dx * scale
        let nb = b - dx * scale
        if (na < 0.2) {
          nb -= 0.2 - na
          na = 0.2
        }
        if (nb < 0.2) {
          na -= 0.2 - nb
          nb = 0.2
        }
        const s = na + nb
        na = (na / s) * startSum
        nb = (nb / s) * startSum
        const next = colFlex.map((r, i) => {
          if (i !== ri) return r
          const cp = [...r]
          cp[afterTi] = na
          cp[afterTi + 1] = nb
          return cp
        })
        onColFlexChange(next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [colFlex, onColFlexChange]
  )

  const startRowResize = useCallback(
    (afterRi: number, e: React.MouseEvent) => {
      e.preventDefault()
      const outer = mosaicOuterRef.current
      if (!outer) return
      const wraps = outer.querySelectorAll<HTMLElement>('.mosaic-row-wrap')
      let base: number[]
      if (rowHeightsPx && rowHeightsPx.length === rows.length) {
        base = [...rowHeightsPx]
      } else {
        base = Array.from(wraps).map((w) => Math.max(120, Math.round(w.getBoundingClientRect().height)))
        while (base.length < rows.length) base.push(200)
        while (base.length > rows.length) base.pop()
        onRowHeightsPxChange([...base])
      }
      const startY = e.clientY
      const ha0 = base[afterRi] ?? 200
      const hb0 = base[afterRi + 1] ?? 200
      const onMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY
        let na = ha0 + dy
        let nb = hb0 - dy
        if (na < 80) {
          nb -= 80 - na
          na = 80
        }
        if (nb < 80) {
          na -= 80 - nb
          nb = 80
        }
        const next = [...base]
        next[afterRi] = Math.round(na)
        next[afterRi + 1] = Math.round(nb)
        onRowHeightsPxChange(next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [mosaicOuterRef, rowHeightsPx, rows.length, onRowHeightsPxChange]
  )

  return (
    <div className="mosaic-outer" ref={mosaicOuterRef}>
      {rows.map((row, ri) => {
        const flexRow = colFlex[ri] ?? row.tiles.map(() => 1)
        const heightStyle =
          rowHeightsPx && rowHeightsPx[ri] != null
            ? { height: rowHeightsPx[ri], minHeight: 80, flexShrink: 0 as const }
            : { flex: '1 1 0', minHeight: 160 }

        return (
          <div key={row.id} className="mosaic-row-stack">
            <div className="mosaic-row-wrap" style={heightStyle}>
              <div
                className="mosaic-row-inner"
                ref={(el) => {
                  rowInnerRefs.current[ri] = el
                }}
                onDragOver={(e) => onRowDragOver(e, ri)}
                onDrop={(e) => onRowDrop(e, ri)}
              >
                {row.tiles.map((kind, ti) => {
                  const w = flexRow[ti] ?? 1
                  const isF = focusedRowIndex === ri && focusedTileKind === kind
                  const showGhostBefore = dropHint?.ri === ri && dropHint.insertAt === ti
                  const meta = TILE_LABELS[kind]
                  return (
                    <Fragment key={`${row.id}-${kind}-${ti}`}>
                      {showGhostBefore ? (
                        <div className="mosaic-drop-ghost" aria-hidden>
                          <span className="mosaic-drop-ghost-inner" />
                        </div>
                      ) : null}
                      <div
                        className={`mosaic-tile ${isF ? 'is-focused' : ''}`}
                        style={{ flex: `${w} 1 0`, minWidth: 100, maxWidth: 'none' }}
                        ref={kind === 'preview' ? previewColumnRef : undefined}
                      >
                        <button
                          type="button"
                          className={`mosaic-tile-head ${isF ? 'is-focused' : ''}`}
                          onClick={() => onFocusHeader(ri, kind)}
                          draggable
                          onDragStart={(e) => onDragStart(e, ri, ti)}
                          onDragEnd={onDragEnd}
                        >
                          <span className="mth-title">{meta.title}</span>
                          <span className="mth-drag" aria-hidden>
                            ⋮⋮
                          </span>
                        </button>
                        <div className="mosaic-tile-body">{renderTileBody(kind, ri, ti)}</div>
                      </div>
                      {ti < row.tiles.length - 1 ? (
                        <div
                          className="mosaic-col-split"
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(e) => startColResize(ri, ti, e)}
                        />
                      ) : null}
                    </Fragment>
                  )
                })}
                {dropHint?.ri === ri && dropHint.insertAt === row.tiles.length ? (
                  <div className="mosaic-drop-ghost mosaic-drop-ghost--end" aria-hidden>
                    <span className="mosaic-drop-ghost-inner" />
                  </div>
                ) : null}
              </div>
            </div>
            {ri < rows.length - 1 ? (
              <div
                className="mosaic-row-split"
                role="separator"
                aria-orientation="horizontal"
                onMouseDown={(e) => startRowResize(ri, e)}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
