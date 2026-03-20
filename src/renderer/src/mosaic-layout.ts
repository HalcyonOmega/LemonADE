export type TileKind = 'preview' | 'agents' | 'terminal' | 'editor' | 'activity'

export type MosaicRow = { id: string; tiles: TileKind[] }

export const MOSAIC_STORAGE_KEY = 'lemonade.mosaic.v2'

export const DEFAULT_MOSAIC: MosaicRow[] = [
  { id: 'r1', tiles: ['preview', 'agents'] },
  { id: 'r2', tiles: ['terminal', 'editor'] },
  { id: 'r3', tiles: ['activity'] }
]

export type MosaicPersisted = {
  rows: MosaicRow[]
  /** null = equal flex rows until user drags a row splitter */
  rowHeightsPx: number[] | null
  /** flex-grow weight per tile */
  colFlex: number[][]
}

const LEGACY_KEY = 'lemonade.mosaic.v1'

function isTileKind(t: string): t is TileKind {
  return t === 'preview' || t === 'agents' || t === 'terminal' || t === 'editor' || t === 'activity'
}

function stripLegacyTiles(tiles: string[]): TileKind[] {
  return tiles.filter((t): t is TileKind => isTileKind(t))
}

function parseRows(raw: unknown): MosaicRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows: MosaicRow[] = []
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as MosaicRow).id === 'string' &&
      Array.isArray((item as MosaicRow).tiles)
    ) {
      const tiles = stripLegacyTiles((item as MosaicRow).tiles as string[])
      if (tiles.length > 0) rows.push({ id: (item as MosaicRow).id, tiles })
    }
  }
  return rows.length > 0 ? rows : null
}

export function defaultColFlex(rows: MosaicRow[]): number[][] {
  return rows.map((r) => r.tiles.map(() => 1))
}

export function ensureColFlexForRows(rows: MosaicRow[], prev: number[][]): number[][] {
  return rows.map((r, ri) => {
    const p = prev[ri] ?? []
    return r.tiles.map((_, ti) => (p[ti] != null && p[ti]! > 0 ? p[ti]! : 1))
  })
}

export function loadMosaicPersisted(): MosaicPersisted {
  if (typeof sessionStorage === 'undefined') {
    return {
      rows: DEFAULT_MOSAIC,
      rowHeightsPx: null,
      colFlex: defaultColFlex(DEFAULT_MOSAIC)
    }
  }
  try {
    const raw = sessionStorage.getItem(MOSAIC_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (p && typeof p === 'object' && Array.isArray((p as MosaicPersisted).rows)) {
        const rows = parseRows((p as MosaicPersisted).rows)
        if (rows) {
          const colFlexRaw = (p as MosaicPersisted).colFlex
          const colFlex = Array.isArray(colFlexRaw)
            ? ensureColFlexForRows(rows, colFlexRaw as number[][])
            : defaultColFlex(rows)
          let rowHeightsPx: number[] | null = null
          const rh = (p as MosaicPersisted).rowHeightsPx
          if (Array.isArray(rh) && rh.length === rows.length && rh.every((n) => typeof n === 'number' && n >= 80)) {
            rowHeightsPx = rh.map((n) => Math.min(2000, Math.max(80, n)))
          }
          return { rows, rowHeightsPx, colFlex }
        }
      }
    }
    const legacy = sessionStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const rows = parseRows(JSON.parse(legacy) as unknown)
      if (rows) {
        return { rows, rowHeightsPx: null, colFlex: defaultColFlex(rows) }
      }
    }
  } catch {
    /* fall through */
  }
  return {
    rows: DEFAULT_MOSAIC,
    rowHeightsPx: null,
    colFlex: defaultColFlex(DEFAULT_MOSAIC)
  }
}

export function saveMosaicPersisted(state: MosaicPersisted): void {
  try {
    sessionStorage.setItem(MOSAIC_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/** Insert a tile to the right of `anchor` in-row, or add a new row below `rowIndex`. */
export function addTileToMosaic(
  rows: MosaicRow[],
  colFlex: number[][],
  opts: {
    kind: TileKind
    axis: 'horizontal' | 'vertical'
    rowIndex: number
    anchorTile: TileKind | null
  }
): { rows: MosaicRow[]; colFlex: number[][] } {
  const { kind, axis, rowIndex, anchorTile } = opts
  if (rowIndex < 0 || rowIndex >= rows.length) return { rows, colFlex }
  const row = rows[rowIndex]
  if (!row) return { rows, colFlex }

  if (axis === 'horizontal') {
    if (row.tiles.includes(kind)) return { rows, colFlex }
    const ti = anchorTile != null ? row.tiles.indexOf(anchorTile) : -1
    const insertAt = ti >= 0 ? ti + 1 : row.tiles.length
    const newTiles = [...row.tiles.slice(0, insertAt), kind, ...row.tiles.slice(insertAt)]
    const rowFlex = [...(colFlex[rowIndex] ?? [])]
    rowFlex.splice(insertAt, 0, 1)
    const newRows = rows.map((r, i) => (i === rowIndex ? { ...r, tiles: newTiles } : r))
    const newFlex = colFlex.map((f, i) => (i === rowIndex ? rowFlex : f))
    return { rows: newRows, colFlex: ensureColFlexForRows(newRows, newFlex) }
  }

  const newRow: MosaicRow = { id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tiles: [kind] }
  const newRows = [...rows.slice(0, rowIndex + 1), newRow, ...rows.slice(rowIndex + 1)]
  const newFlex = [...colFlex.slice(0, rowIndex + 1), [1], ...colFlex.slice(rowIndex + 1)]
  return { rows: newRows, colFlex: ensureColFlexForRows(newRows, newFlex) }
}

export function moveTileInRow(
  rows: MosaicRow[],
  colFlex: number[][],
  rowIndex: number,
  focusedKind: TileKind | null,
  delta: -1 | 1
): { rows: MosaicRow[]; colFlex: number[][] } {
  if (focusedKind == null || rowIndex < 0 || rowIndex >= rows.length) return { rows, colFlex }
  const row = rows[rowIndex]
  if (!row) return { rows, colFlex }
  const i = row.tiles.indexOf(focusedKind)
  if (i < 0) return { rows, colFlex }
  const j = i + delta
  if (j < 0 || j >= row.tiles.length) return { rows, colFlex }
  const newTiles = [...row.tiles]
  ;[newTiles[i], newTiles[j]] = [newTiles[j], newTiles[i]]
  const f = [...(colFlex[rowIndex] ?? [])]
  ;[f[i], f[j]] = [f[j], f[i]]
  const newRows = rows.map((r, ri) => (ri === rowIndex ? { ...r, tiles: newTiles } : r))
  const newFlex = colFlex.map((cf, ri) => (ri === rowIndex ? f : cf))
  return { rows: newRows, colFlex: newFlex }
}

export function moveRow(
  rows: MosaicRow[],
  colFlex: number[][],
  rowIndex: number,
  delta: -1 | 1
): { rows: MosaicRow[]; colFlex: number[][] } {
  const j = rowIndex + delta
  if (rowIndex < 0 || rowIndex >= rows.length || j < 0 || j >= rows.length) return { rows, colFlex }
  const nextR = [...rows]
  ;[nextR[rowIndex], nextR[j]] = [nextR[j], nextR[rowIndex]]
  const nextF = [...colFlex]
  ;[nextF[rowIndex], nextF[j]] = [nextF[j], nextF[rowIndex]]
  return { rows: nextR, colFlex: nextF }
}

/** Move a tile from (fromRi, fromTi) to row toRi before index insertAt (0 = start). */
export function moveTileBetween(
  rows: MosaicRow[],
  colFlex: number[][],
  fromRi: number,
  fromTi: number,
  toRi: number,
  insertAt: number
): { rows: MosaicRow[]; colFlex: number[][] } {
  if (fromRi < 0 || fromRi >= rows.length) return { rows, colFlex }
  const rowFrom = rows[fromRi]
  if (!rowFrom || fromTi < 0 || fromTi >= rowFrom.tiles.length) return { rows, colFlex }
  if (toRi < 0 || toRi >= rows.length) return { rows, colFlex }
  const kind = rowFrom.tiles[fromTi]
  const w = colFlex[fromRi]?.[fromTi] ?? 1

  const newRows = rows.map((r) => ({ ...r, tiles: [...r.tiles] }))
  const newFlex = colFlex.map((r) => [...r])

  newRows[fromRi].tiles.splice(fromTi, 1)
  newFlex[fromRi].splice(fromTi, 1)

  let ins = Math.max(0, Math.min(insertAt, newRows[toRi].tiles.length))
  if (fromRi === toRi && fromTi < ins) ins -= 1

  newRows[toRi].tiles.splice(ins, 0, kind)
  newFlex[toRi].splice(ins, 0, w)

  const prunedRows: MosaicRow[] = []
  const prunedFlex: number[][] = []
  for (let i = 0; i < newRows.length; i++) {
    if (newRows[i].tiles.length > 0) {
      prunedRows.push(newRows[i])
      prunedFlex.push(newFlex[i])
    }
  }
  return { rows: prunedRows, colFlex: ensureColFlexForRows(prunedRows, prunedFlex) }
}

export const TILE_LABELS: Record<TileKind, { title: string }> = {
  preview: { title: 'Preview' },
  agents: { title: 'Agents' },
  terminal: { title: 'Terminal' },
  editor: { title: 'Editor' },
  activity: { title: 'Activity' }
}
