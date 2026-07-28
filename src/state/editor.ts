import { create } from 'zustand'
import {
  clampZoom,
  fitBox,
  screenToWorld,
  zoomAt,
  type Box,
  type ViewTransform,
} from '../canvas/view'
import type { Tool } from '../model/types'

/**
 * Editor state that is NOT part of the document history:
 * view transform, viewport size, cursor readout, active tool, snap flags.
 */
export interface SelectionState {
  atomIds: ReadonlySet<string>
  bondIds: ReadonlySet<string>
}

const EMPTY_SEL: SelectionState = { atomIds: new Set(), bondIds: new Set() }

export type BondStereoTool = 'none' | 'wedge' | 'dash' | 'wavy'

export interface RingTemplateRef {
  id: string // key into RING_TEMPLATES
}

export interface HoverState {
  atomId: string | null
  bondId: string | null
}

interface EditorState {
  view: ViewTransform
  viewport: { w: number; h: number }
  cursor: { x: number; y: number } | null // world coords, for the bottom-bar readout
  tool: Tool
  gridSnap: boolean
  selection: SelectionState

  /** Tool parameters */
  currentElement: string // atom tool
  currentBondOrder: 1 | 2 | 3
  currentBondStereo: BondStereoTool
  currentRing: string // ring template id
  currentArrow: import('../model/types').ReactionKind
  hover: HoverState

  /** Transient interaction state (never in history) */
  dragOffset: { dx: number; dy: number } | null // applied to selected atoms while moving
  pendingErase: ReadonlySet<string> // atom/bond ids dimmed mid-erase-drag
  marquee: { x1: number; y1: number; x2: number; y2: number } | null
  lasso: { x: number; y: number }[] | null
  bondGhost: { from: { x: number; y: number }; to: { x: number; y: number }; toAtomId: string | null } | null
  chainGhost: { x: number; y: number }[] | null
  ringGhost: import('../model/types').Molecule | null
  contextMenu: { x: number; y: number; kind: 'atom' | 'bond' | 'canvas'; targetId: string | null } | null

  setViewport: (w: number, h: number) => void
  setView: (v: ViewTransform) => void
  panBy: (dx: number, dy: number) => void
  zoomAtPoint: (sx: number, sy: number, factor: number) => void
  /** Zoom keeping the viewport center fixed. */
  zoomCentered: (factor: number) => void
  /** Set an absolute zoom level, viewport-centered. */
  setZoom: (zoom: number) => void
  /** Fit the given bounds (world coords); with null, reset to origin at 100%. */
  fitView: (bounds: Box | null) => void
  setCursor: (c: { x: number; y: number } | null) => void
  setTool: (t: Tool) => void
  toggleGridSnap: () => void

  /** Replace the selection. Pass nothing to clear. */
  select: (sel?: { atomIds?: Iterable<string>; bondIds?: Iterable<string> }) => void
  /** Toggle a single atom/bond in the selection (shift-click). */
  toggleSelected: (kind: 'atom' | 'bond', id: string) => void
  clearSelection: () => void

  setCurrentElement: (el: string) => void
  setCurrentBondOrder: (o: 1 | 2 | 3) => void
  setCurrentBondStereo: (s: BondStereoTool) => void
  setCurrentRing: (id: string) => void
  setCurrentArrow: (k: import('../model/types').ReactionKind) => void
  setHover: (h: Partial<HoverState>) => void
  setDragOffset: (o: { dx: number; dy: number } | null) => void
  setPendingErase: (ids: ReadonlySet<string>) => void
  setMarquee: (m: { x1: number; y1: number; x2: number; y2: number } | null) => void
  setLasso: (pts: { x: number; y: number }[] | null) => void
  setBondGhost: (g: EditorState['bondGhost']) => void
  setChainGhost: (g: EditorState['chainGhost']) => void
  setRingGhost: (g: EditorState['ringGhost']) => void
  setContextMenu: (m: EditorState['contextMenu']) => void
  /** Clear every transient interaction artifact (drag cancel / Escape). */
  clearTransients: () => void
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  view: { x: 0, y: 0, zoom: 1 },
  viewport: { w: 0, h: 0 },
  cursor: null,
  tool: 'select',
  gridSnap: false,
  selection: EMPTY_SEL,
  currentElement: 'C',
  currentBondOrder: 1,
  currentBondStereo: 'none',
  currentRing: 'benzene',
  currentArrow: 'forward',
  hover: { atomId: null, bondId: null },
  dragOffset: null,
  pendingErase: new Set<string>(),
  marquee: null,
  lasso: null,
  bondGhost: null,
  chainGhost: null,
  ringGhost: null,
  contextMenu: null,

  setViewport: (w, h) =>
    set((s) => {
      // First measurement: put the world origin at the viewport center.
      if (s.viewport.w === 0 && s.viewport.h === 0 && s.view.x === 0 && s.view.y === 0) {
        return { viewport: { w, h }, view: { x: w / 2, y: h / 2, zoom: 1 } }
      }
      return { viewport: { w, h } }
    }),
  setView: (view) => set({ view }),
  panBy: (dx, dy) => set((s) => ({ view: { ...s.view, x: s.view.x + dx, y: s.view.y + dy } })),
  zoomAtPoint: (sx, sy, factor) => set((s) => ({ view: zoomAt(s.view, sx, sy, factor) })),
  zoomCentered: (factor) => {
    const { viewport } = get()
    get().zoomAtPoint(viewport.w / 2, viewport.h / 2, factor)
  },
  setZoom: (zoom) => {
    const { view, viewport } = get()
    const z = clampZoom(zoom)
    const c = screenToWorld(view, viewport.w / 2, viewport.h / 2)
    set({ view: { zoom: z, x: viewport.w / 2 - c.x * z, y: viewport.h / 2 - c.y * z } })
  },
  fitView: (bounds) => {
    const { viewport } = get()
    if (!bounds) {
      set({ view: { x: viewport.w / 2, y: viewport.h / 2, zoom: 1 } })
    } else {
      set({ view: fitBox(bounds, viewport.w, viewport.h) })
    }
  },
  setCursor: (cursor) => set({ cursor }),
  setTool: (tool) => set({ tool }),
  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),

  select: (sel) =>
    set({
      selection: sel
        ? { atomIds: new Set(sel.atomIds ?? []), bondIds: new Set(sel.bondIds ?? []) }
        : EMPTY_SEL,
    }),
  toggleSelected: (kind, id) =>
    set((s) => {
      const atomIds = new Set(s.selection.atomIds)
      const bondIds = new Set(s.selection.bondIds)
      const target = kind === 'atom' ? atomIds : bondIds
      if (target.has(id)) target.delete(id)
      else target.add(id)
      return { selection: { atomIds, bondIds } }
    }),
  clearSelection: () => set({ selection: EMPTY_SEL }),

  setCurrentElement: (currentElement) => set({ currentElement, tool: 'atom' }),
  setCurrentBondOrder: (currentBondOrder) => set({ currentBondOrder, currentBondStereo: 'none', tool: 'bond' }),
  setCurrentBondStereo: (currentBondStereo) => set({ currentBondStereo, tool: 'bond' }),
  setCurrentRing: (currentRing) => set({ currentRing, tool: 'ring' }),
  setCurrentArrow: (currentArrow) => set({ currentArrow, tool: 'arrow' }),
  setHover: (h) => set((s) => ({ hover: { ...s.hover, ...h } })),
  setDragOffset: (dragOffset) => set({ dragOffset }),
  setPendingErase: (pendingErase) => set({ pendingErase }),
  setMarquee: (marquee) => set({ marquee }),
  setLasso: (lasso) => set({ lasso }),
  setBondGhost: (bondGhost) => set({ bondGhost }),
  setChainGhost: (chainGhost) => set({ chainGhost }),
  setRingGhost: (ringGhost) => set({ ringGhost }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  clearTransients: () =>
    set({
      dragOffset: null,
      pendingErase: new Set<string>(),
      marquee: null,
      lasso: null,
      bondGhost: null,
      chainGhost: null,
      ringGhost: null,
    }),
}))

// Dev-only: expose the store for debugging from the browser console.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__editor = useEditorStore
}
