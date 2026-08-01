import { Box } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { openAR } from '../state/ar'
import { placeStructureFromSmiles } from '../state/actions'
import {
  addBond,
  addChain,
  addFreeBond,
  addLabel,
  deleteLabel,
  deleteItems,
  growBond,
  moveAtoms,
  placeAtom,
  placeMolecule,
  setAtomElement,
  setBondOrder,
  setBondStereo,
  cycleBondOrder,
  findBond,
  updateLabel,
} from '../state/docActions'
import { useDocStore } from '../state/doc'
import { useEditorStore } from '../state/editor'
import { useUIStore } from '../state/store'
import { MOD } from '../ui/platform'
import { chainPoints, pointInPolygon, snapBondEnd, type Pt } from './geometry'
import { hitAtomAt, hitBondAt, itemsInPolygon, itemsInRect, ringPlacement } from './interactions'
import { screenToWorld, worldToScreen } from './view'
import { addReaction, deleteReaction, deleteBracket } from '../state/docActions'
import Minimap from './Minimap'
import MoleculeLayer from './MoleculeLayer'
import ReactionLayer from './ReactionLayer'
import BracketLayer from './BracketLayer'
import GhostLayer from './GhostLayer'

const SAMPLES: { name: string; smiles: string }[] = [
  { name: 'Benzene', smiles: 'c1ccccc1' },
  { name: 'Caffeine', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C' },
  { name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
  { name: 'Glucose', smiles: 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O' },
]

function EmptyState() {
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
      <p className="pointer-events-none max-w-[360px] text-center text-[15px] leading-relaxed text-muted">
        Press{' '}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="pointer-events-auto rounded-[4px] border border-edge bg-panel px-1.5 py-0.5 font-mono text-[12px] text-secondary transition-colors duration-150 hover:border-edge-strong hover:text-primary"
        >
          {MOD}K
        </button>{' '}
        to type a molecule name, or pick a tool and start drawing.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() => placeStructureFromSmiles(s.smiles, s.name.toLowerCase())}
            className="rounded-[4px] border border-edge bg-panel px-2.5 py-1 text-[13px] text-secondary transition-colors duration-150 hover:border-edge-strong hover:bg-hover hover:text-primary"
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Free-text labels with light chemical formatting (digits after letters → subscript). */
function LabelsLayer({ onEdit }: { onEdit: (id: string, x: number, y: number, text: string) => void }) {
  const labels = useDocStore((s) => s.labels)
  return (
    <>
      {labels.map((l) => {
        const parts = l.text.split(/(\d+)/)
        return (
          <text
            key={l.id}
            x={l.x}
            y={l.y}
            fontSize={l.fontSize}
            fontFamily="var(--font-ui)"
            fill="var(--stroke-mol)"
            data-label={l.id}
            style={{ cursor: 'text', userSelect: 'none' }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onEdit(l.id, l.x, l.y, l.text)
            }}
          >
            {parts.map((p, i) =>
              /^\d+$/.test(p) && i > 0 && /[A-Za-z)\]]$/.test(parts[i - 1] ?? '') ? (
                <tspan key={i} fontSize={l.fontSize * 0.72} baselineShift="-22%">
                  {p}
                </tspan>
              ) : (
                <tspan key={i}>{p}</tspan>
              ),
            )}
          </text>
        )
      })}
    </>
  )
}

/** Adaptive dot-grid spacing: keeps dots between ~14 and ~56 screen px apart. */
function gridSpacing(zoom: number): number {
  let s = 24 * zoom
  while (s < 14) s *= 2
  while (s > 56) s /= 2
  return s
}

type DragKind =
  | 'none'
  | 'pan'
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'bondDraw'
  | 'bondClick'
  | 'chain'
  | 'erase'
  | 'arrowDraw'

interface DragState {
  kind: DragKind
  pointerId: number
  start: Pt // world
  lastScreen: Pt
  moved: boolean
  fromAtomId: string | null
  fromPt: Pt
  bondId: string | null
  moveSet: ReadonlySet<string>
  eraseIds: Set<string>
}

interface TextEdit {
  id: string | null
  world: Pt
  value: string
}

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const view = useEditorStore((s) => s.view)
  const tool = useEditorStore((s) => s.tool)
  const rdkitReady = useUIStore((s) => s.rdkitReady)
  const isEmpty = useDocStore((s) => s.molecules.length === 0 && s.labels.length === 0)

  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const drag = useRef<DragState | null>(null)
  const suppressClick = useRef(false)

  // Viewport size tracking
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { setViewport } = useEditorStore.getState()
    const measure = () => {
      const r = el.getBoundingClientRect()
      setViewport(r.width, r.height)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Space-to-pan tracking (ignore when typing in a field)
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        setSpaceHeld(true)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Wheel zoom (native listener so preventDefault works)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0015))
      useEditorStore.getState().zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const p = toLocal(e)
    return screenToWorld(useEditorStore.getState().view, p.x, p.y)
  }

  const tolAtom = () => 12 / useEditorStore.getState().view.zoom
  const tolBond = () => 10 / useEditorStore.getState().view.zoom

  const updateHover = useCallback((world: Pt) => {
    const editor = useEditorStore.getState()
    const atom = hitAtomAt(world, 12 / editor.view.zoom)
    const bond = atom ? null : hitBondAt(world, 10 / editor.view.zoom)
    const h = editor.hover
    const nextAtom = atom?.atomId ?? null
    const nextBond = bond?.bondId ?? null
    if (h.atomId !== nextAtom || h.bondId !== nextBond) {
      editor.setHover({ atomId: nextAtom, bondId: nextBond })
    }
  }, [])

  const commitTextEdit = useCallback((edit: TextEdit) => {
    const text = edit.value.trim()
    if (edit.id) updateLabel(edit.id, text)
    else if (text) addLabel(edit.world, text)
    setTextEdit(null)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (textEdit) commitTextEdit(textEdit)
    const isPan = e.button === 1 || (e.button === 0 && spaceHeld)
    const local = toLocal(e)
    const world = toWorld(e)

    if (isPan) {
      drag.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        start: world,
        lastScreen: local,
        moved: false,
        fromAtomId: null,
        fromPt: world,
        bondId: null,
        moveSet: new Set(),
        eraseIds: new Set(),
      }
      setPanning(true)
      ;try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* synthetic events have no capturable pointer */ }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    const editor = useEditorStore.getState()
    const atom = hitAtomAt(world, tolAtom())
    const bond = atom ? null : hitBondAt(world, tolBond())
    const base: DragState = {
      kind: 'none',
      pointerId: e.pointerId,
      start: world,
      lastScreen: local,
      moved: false,
      fromAtomId: atom?.atomId ?? null,
      fromPt: atom ? { x: atom.x, y: atom.y } : world,
      bondId: bond?.bondId ?? null,
      moveSet: new Set(),
      eraseIds: new Set(),
    }

    switch (editor.tool) {
      case 'select': {
        if (atom) {
          let sel = editor.selection
          if (!sel.atomIds.has(atom.atomId)) {
            if (e.shiftKey) {
              editor.toggleSelected('atom', atom.atomId)
            } else {
              editor.select({ atomIds: [atom.atomId] })
            }
            sel = useEditorStore.getState().selection
          }
          const moveSet = new Set(sel.atomIds)
          for (const bid of sel.bondIds) {
            const fb = findBond(bid)
            if (fb) {
              moveSet.add(fb.bond.a1)
              moveSet.add(fb.bond.a2)
            }
          }
          drag.current = { ...base, kind: 'move', moveSet }
        } else if (bond) {
          let sel = editor.selection
          if (!sel.bondIds.has(bond.bondId)) {
            if (e.shiftKey) editor.toggleSelected('bond', bond.bondId)
            else editor.select({ bondIds: [bond.bondId] })
            sel = useEditorStore.getState().selection
          }
          const moveSet = new Set(sel.atomIds)
          for (const bid of sel.bondIds) {
            const fb = findBond(bid)
            if (fb) {
              moveSet.add(fb.bond.a1)
              moveSet.add(fb.bond.a2)
            }
          }
          drag.current = { ...base, kind: 'move', moveSet }
        } else {
          drag.current = { ...base, kind: e.altKey ? 'lasso' : 'marquee' }
          if (e.altKey) editor.setLasso([world])
          else editor.setMarquee({ x1: world.x, y1: world.y, x2: world.x, y2: world.y })
        }
        break
      }
      case 'atom':
      case 'bond': {
        if (editor.tool === 'bond' && bond && !atom) {
          drag.current = { ...base, kind: 'bondClick' }
        } else {
          drag.current = { ...base, kind: 'bondDraw' }
        }
        break
      }
      case 'ring': {
        drag.current = { ...base, kind: 'none' }
        // Placement happens on pointer-up (click); ghost is already live.
        break
      }
      case 'chain': {
        drag.current = { ...base, kind: 'chain' }
        break
      }
      case 'eraser': {
        drag.current = { ...base, kind: 'erase' }
        const t = e.target as SVGElement
        const labelId = t.getAttribute?.('data-label')
        const arrowId = t.getAttribute?.('data-arrow')
        const bracketId = t.getAttribute?.('data-bracket')
        if (labelId) {
          deleteLabel(labelId)
        } else if (arrowId) {
          deleteReaction(arrowId)
        } else if (bracketId) {
          deleteBracket(bracketId)
        } else if (atom) base.eraseIds.add(atom.atomId)
        else if (bond) base.eraseIds.add(bond.bondId)
        editor.setPendingErase(new Set(base.eraseIds))
        break
      }
      case 'arrow': {
        drag.current = { ...base, kind: 'arrowDraw' }
        break
      }
      case 'text': {
        drag.current = { ...base, kind: 'none' }
        break
      }
      default:
        drag.current = { ...base, kind: 'none' }
    }
    ;try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* synthetic events have no capturable pointer */ }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const local = toLocal(e)
    const world = toWorld(e)
    const editor = useEditorStore.getState()
    editor.setCursor(world)
    updateHover(world)

    // Ring ghost follows the cursor continuously
    if (editor.tool === 'ring' && !drag.current?.moved) {
      const h = useEditorStore.getState().hover
      editor.setRingGhost(ringPlacement(editor.currentRing, world, h))
    } else if (editor.tool !== 'ring' && editor.ringGhost) {
      editor.setRingGhost(null)
    }

    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const movedNow =
      Math.hypot(local.x - d.lastScreen.x, local.y - d.lastScreen.y) > 0 &&
      Math.hypot(world.x - d.start.x, world.y - d.start.y) * editor.view.zoom > 3
    if (movedNow) d.moved = true

    switch (d.kind) {
      case 'pan': {
        editor.panBy(local.x - d.lastScreen.x, local.y - d.lastScreen.y)
        d.lastScreen = local
        suppressClick.current = true
        break
      }
      case 'move': {
        if (d.moved) {
          editor.setDragOffset({ dx: world.x - d.start.x, dy: world.y - d.start.y })
          suppressClick.current = true
        }
        break
      }
      case 'marquee': {
        editor.setMarquee({ x1: d.start.x, y1: d.start.y, x2: world.x, y2: world.y })
        break
      }
      case 'lasso': {
        editor.setLasso([...(editor.lasso ?? []), world])
        break
      }
      case 'bondDraw': {
        if (!d.moved) break
        const from = d.fromPt
        const targetAtom = hitAtomAt(world, 14 / editor.view.zoom)
        const validTarget = targetAtom && targetAtom.atomId !== d.fromAtomId ? targetAtom : null
        const to = validTarget
          ? { x: validTarget.x, y: validTarget.y }
          : snapBondEnd(from, world, e.altKey)
        editor.setBondGhost({ from, to, toAtomId: validTarget?.atomId ?? null })
        break
      }
      case 'chain': {
        if (!d.moved) break
        editor.setChainGhost(chainPoints(d.fromPt, world))
        break
      }
      case 'arrowDraw': {
        if (!d.moved) break
        const dx = world.x - d.start.x
        const dy = world.y - d.start.y
        const dist = Math.hypot(dx, dy)
        let to = world
        if (!e.altKey && dist > 0) {
          const step = Math.PI / 12
          const a = Math.round(Math.atan2(dy, dx) / step) * step
          to = { x: d.start.x + Math.cos(a) * dist, y: d.start.y + Math.sin(a) * dist }
        }
        editor.setBondGhost({ from: d.start, to, toAtomId: null })
        break
      }
      case 'erase': {
        const atom = hitAtomAt(world, tolAtom())
        const bond = atom ? null : hitBondAt(world, tolBond())
        let changed = false
        if (atom && !d.eraseIds.has(atom.atomId)) {
          d.eraseIds.add(atom.atomId)
          changed = true
        }
        if (bond && !d.eraseIds.has(bond.bondId)) {
          d.eraseIds.add(bond.bondId)
          changed = true
        }
        if (changed) editor.setPendingErase(new Set(d.eraseIds))
        break
      }
      default:
        break
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    const world = toWorld(e)
    const editor = useEditorStore.getState()

    switch (d.kind) {
      case 'pan': {
        setPanning(false)
        break
      }
      case 'move': {
        if (d.moved) {
          editor.setDragOffset(null)
          const dx = world.x - d.start.x
          const dy = world.y - d.start.y
          moveAtoms(d.moveSet, dx, dy)
        }
        break
      }
      case 'marquee': {
        const m = editor.marquee
        editor.setMarquee(null)
        if (m && d.moved) {
          const found = itemsInRect(m)
          if (e.shiftKey) {
            editor.select({
              atomIds: [...editor.selection.atomIds, ...found.atomIds],
              bondIds: [...editor.selection.bondIds, ...found.bondIds],
            })
          } else {
            editor.select(found)
          }
        } else if (!e.shiftKey) {
          editor.clearSelection()
        }
        break
      }
      case 'lasso': {
        const pts = editor.lasso
        editor.setLasso(null)
        if (pts && pts.length > 2 && d.moved) {
          editor.select(itemsInPolygon(pts, pointInPolygon))
        }
        break
      }
      case 'bondDraw': {
        const ghost = editor.bondGhost
        editor.setBondGhost(null)
        const isAtomTool = editor.tool === 'atom'
        const order = isAtomTool ? 1 : editor.currentBondOrder
        const stereo = isAtomTool ? 'none' : editor.currentBondStereo === 'none' ? 'none' : editor.currentBondStereo
        const element = isAtomTool ? editor.currentElement : 'C'
        if (!d.moved) {
          // Click
          if (isAtomTool) {
            if (d.fromAtomId) setAtomElement(d.fromAtomId, editor.currentElement)
            else placeAtom(snapMaybe(d.start, editor.gridSnap), editor.currentElement)
          } else {
            if (d.fromAtomId) growBond(d.fromAtomId, order, stereo, 'C')
            else {
              const to = snapBondEnd(d.start, { x: d.start.x + 1, y: d.start.y - 0.6 }, false)
              addFreeBond(d.start, to, order, stereo, 'C')
            }
          }
        } else if (ghost) {
          if (d.fromAtomId) {
            addBond(
              d.fromAtomId,
              ghost.toAtomId ? { atomId: ghost.toAtomId } : ghost.to,
              order,
              stereo,
              element,
            )
          } else if (ghost.toAtomId) {
            addBond(ghost.toAtomId, ghost.from, order, stereo, element)
          } else {
            addFreeBond(ghost.from, ghost.to, order, stereo, element)
          }
        }
        break
      }
      case 'bondClick': {
        if (d.bondId) {
          const editorNow = useEditorStore.getState()
          if (editorNow.currentBondStereo !== 'none') {
            setBondStereo(d.bondId, editorNow.currentBondStereo)
          } else {
            const fb = findBond(d.bondId)
            if (fb && fb.bond.order === editorNow.currentBondOrder) cycleBondOrder(d.bondId)
            else setBondOrder(d.bondId, editorNow.currentBondOrder)
          }
        }
        break
      }
      case 'chain': {
        const pts = editor.chainGhost
        editor.setChainGhost(null)
        if (pts && pts.length > 0 && d.moved) {
          addChain(pts, d.fromAtomId)
        }
        break
      }
      case 'arrowDraw': {
        const ghost = editor.bondGhost
        editor.setBondGhost(null)
        const kind = editor.currentArrow
        if (!d.moved || !ghost) {
          // Click: default horizontal arrow at the click point
          if (kind === 'curly') {
            addReaction({ kind, x: d.start.x, y: d.start.y, length: 0, x2: d.start.x + 80, y2: d.start.y - 40 })
          } else {
            addReaction({ kind, x: d.start.x, y: d.start.y, length: 100, angle: 0 })
          }
        } else {
          const dx = ghost.to.x - ghost.from.x
          const dy = ghost.to.y - ghost.from.y
          const dist = Math.hypot(dx, dy)
          if (kind === 'curly') {
            addReaction({ kind, x: ghost.from.x, y: ghost.from.y, length: 0, x2: ghost.to.x, y2: ghost.to.y })
          } else {
            addReaction({
              kind,
              x: ghost.from.x,
              y: ghost.from.y,
              length: Math.max(dist, 60),
              angle: Math.atan2(dy, dx),
            })
          }
        }
        break
      }
      case 'erase': {
        editor.setPendingErase(new Set())
        if (d.eraseIds.size > 0) {
          const atomIds = new Set<string>()
          const bondIds = new Set<string>()
          for (const id of d.eraseIds) {
            if (id.startsWith('a')) atomIds.add(id)
            else bondIds.add(id)
          }
          deleteItems(atomIds, bondIds)
        }
        break
      }
      case 'none': {
        if (editor.tool === 'ring' && !d.moved) {
          const ghost = editor.ringGhost ?? ringPlacement(editor.currentRing, world, editor.hover)
          if (ghost) {
            placeMolecule(ghost)
            editor.setRingGhost(null)
          }
        } else if (editor.tool === 'text' && !d.moved) {
          setTextEdit({ id: null, world, value: '' })
        }
        break
      }
      default:
        break
    }
  }

  // Escape cancels any in-flight interaction
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const editor = useEditorStore.getState()
      if (textEdit) {
        setTextEdit(null)
        return
      }
      if (drag.current && drag.current.kind !== 'none') {
        drag.current = null
        setPanning(false)
        editor.clearTransients()
      } else {
        editor.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [textEdit])

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const editor = useEditorStore.getState()
    if (editor.tool !== 'select') return
    const t = e.target as SVGElement
    const atomId = t.getAttribute?.('data-atom')
    const bondId = t.getAttribute?.('data-bond')
    if (atomId) {
      if (e.shiftKey) editor.toggleSelected('atom', atomId)
      else editor.select({ atomIds: [atomId] })
    } else if (bondId) {
      if (e.shiftKey) editor.toggleSelected('bond', bondId)
      else editor.select({ bondIds: [bondId] })
    }
  }

  const spacing = gridSpacing(view.zoom)
  const gridX = ((view.x % spacing) + spacing) % spacing
  const gridY = ((view.y % spacing) + spacing) % spacing

  const cursorStyle = panning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : tool === 'text'
        ? 'text'
        : tool === 'eraser'
          ? 'cell'
          : tool === 'select'
            ? 'default'
            : 'crosshair'

  const textScreen = textEdit ? worldToScreen(view, textEdit.world.x, textEdit.world.y) : null

  return (
    <main
      ref={containerRef}
      className="print-canvas relative flex-1 overflow-hidden bg-canvas"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        useEditorStore.getState().setCursor(null)
        useEditorStore.getState().setRingGhost(null)
      }}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        const world = toWorld(e)
        const atom = hitAtomAt(world, tolAtom())
        const bond = atom ? null : hitBondAt(world, tolBond())
        useEditorStore.getState().setContextMenu({
          x: e.clientX,
          y: e.clientY,
          kind: atom ? 'atom' : bond ? 'bond' : 'canvas',
          targetId: atom?.atomId ?? bond?.bondId ?? null,
        })
      }}
    >
      <svg className="absolute inset-0 h-full w-full touch-none select-none" role="img" aria-label="Drawing canvas">
        <defs>
          <pattern
            id="dot-grid"
            x={gridX}
            y={gridY}
            width={spacing}
            height={spacing}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1} cy={1} r={1} fill="var(--grid-dot)" />
          </pattern>
        </defs>
        <rect className="grid-rect" width="100%" height="100%" fill="url(#dot-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <MoleculeLayer />
          <ReactionLayer />
          <BracketLayer />
          <LabelsLayer
            onEdit={(id, x, y, text) => setTextEdit({ id, world: { x, y }, value: text })}
          />
          <GhostLayer />
        </g>
      </svg>

      {!rdkitReady && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-[6px] bg-panel/80 px-3 py-1.5 text-[13px] text-muted">
            loading chemistry engine…
          </p>
        </div>
      )}
      {rdkitReady && isEmpty && tool === 'select' && <EmptyState />}

      {textEdit && textScreen && (
        <input
          autoFocus
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTextEdit(textEdit)
            if (e.key === 'Escape') setTextEdit(null)
          }}
          onBlur={() => commitTextEdit(textEdit)}
          placeholder="Label…"
          className="absolute z-10 w-[160px] rounded-[6px] border border-edge-strong bg-panel px-2 py-1 text-[13px] text-primary shadow-lg focus:outline-none"
          style={{ left: textScreen.x, top: textScreen.y - 14 }}
        />
      )}

      <ARButton />
      <Minimap />
    </main>
  )
}

/**
 * Floating "View in AR" call-to-action, anchored above the current
 * selection so it reads as belonging to that molecule. Only shows for the
 * select tool, where a deliberate selection has actually been made.
 */
function ARButton() {
  const selection = useEditorStore((s) => s.selection)
  const view = useEditorStore((s) => s.view)
  const tool = useEditorStore((s) => s.tool)
  const molecules = useDocStore((s) => s.molecules)

  if (tool !== 'select') return null
  if (selection.atomIds.size === 0 && selection.bondIds.size === 0) return null

  // Bounding box of every selected atom (bonds pull in their endpoints).
  const ids = new Set(selection.atomIds)
  for (const m of molecules) {
    for (const b of m.bonds) {
      if (selection.bondIds.has(b.id)) {
        ids.add(b.a1)
        ids.add(b.a2)
      }
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  for (const m of molecules) {
    for (const a of m.atoms) {
      if (!ids.has(a.id)) continue
      minX = Math.min(minX, a.x)
      minY = Math.min(minY, a.y)
      maxX = Math.max(maxX, a.x)
    }
  }
  if (!Number.isFinite(minX)) return null

  const top = worldToScreen(view, (minX + maxX) / 2, minY)
  return (
    <button
      type="button"
      onClick={() => openAR()}
      title="View this molecule in 3D over your camera"
      className="absolute z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-accent px-3.5 py-2 text-[13px] font-semibold text-white shadow-lg transition-transform duration-150 hover:-translate-y-0.5 hover:brightness-110"
      style={{ left: top.x, top: Math.max(52, top.y - 46) }}
    >
      <Box size={14} strokeWidth={2.2} /> View in AR
    </button>
  )
}

function snapMaybe(p: Pt, gridSnap: boolean): Pt {
  if (!gridSnap) return p
  const g = 24
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
}
