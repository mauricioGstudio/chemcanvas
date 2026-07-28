import { useRef, useState } from 'react'
import type { Reaction } from '../model/types'
import { useDocStore } from '../state/doc'
import { deleteReaction, updateReaction } from '../state/docActions'
import { useEditorStore } from '../state/editor'

/**
 * Reaction arrows (§7.6): forward, equilibrium, retrosynthetic, resonance,
 * and curly electron-pushing arrows, with editable conditions text.
 * Arrows are dragged directly (select tool); double-click edits conditions.
 */

function ArrowGlyph({ r, stroke }: { r: Reaction; stroke: string }) {
  const ang = r.angle ?? 0
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const x2 = r.x + r.length * cos
  const y2 = r.y + r.length * sin
  const n = { x: -sin, y: cos } // perpendicular
  const common = { stroke, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const }
  const head = (tipX: number, tipY: number, dir: 1 | -1, half?: 'up' | 'down') => {
    const hx = tipX - dir * 11 * cos
    const hy = tipY - dir * 11 * sin
    const parts: string[] = []
    if (half !== 'down') parts.push(`M ${hx + n.x * 5.5} ${hy + n.y * 5.5} L ${tipX} ${tipY}`)
    if (half !== 'up') parts.push(`M ${hx - n.x * 5.5} ${hy - n.y * 5.5} L ${tipX} ${tipY}`)
    return <path d={parts.join(' ')} {...common} className="mol-stroke" />
  }

  if (r.kind === 'curly' && r.x2 !== undefined && r.y2 !== undefined) {
    const mx = (r.x + r.x2) / 2
    const my = (r.y + r.y2) / 2
    const dx = r.x2 - r.x
    const dy = r.y2 - r.y
    const d = Math.hypot(dx, dy) || 1
    const bowX = mx - (dy / d) * d * 0.35
    const bowY = my + (dx / d) * d * 0.35
    // arrowhead along curve end tangent
    const tx = r.x2 - bowX
    const ty = r.y2 - bowY
    const tl = Math.hypot(tx, ty) || 1
    const ux = tx / tl
    const uy = ty / tl
    const px = -uy
    const py = ux
    return (
      <g>
        <path d={`M ${r.x} ${r.y} Q ${bowX} ${bowY} ${r.x2} ${r.y2}`} {...common} className="mol-stroke" />
        <path
          d={`M ${r.x2 - ux * 10 + px * 5} ${r.y2 - uy * 10 + py * 5} L ${r.x2} ${r.y2} L ${r.x2 - ux * 10 - px * 5} ${r.y2 - uy * 10 - py * 5}`}
          {...common}
          className="mol-stroke"
        />
      </g>
    )
  }

  switch (r.kind) {
    case 'forward':
      return (
        <g>
          <line x1={r.x} y1={r.y} x2={x2} y2={y2} {...common} className="mol-stroke" />
          {head(x2, y2, 1)}
        </g>
      )
    case 'retro': {
      const o = 3.2
      return (
        <g>
          <line x1={r.x + n.x * o} y1={r.y + n.y * o} x2={x2 + n.x * o} y2={y2 + n.y * o} {...common} className="mol-stroke" />
          <line x1={r.x - n.x * o} y1={r.y - n.y * o} x2={x2 - n.x * o} y2={y2 - n.y * o} {...common} className="mol-stroke" />
          <path
            d={`M ${x2 - 12 * cos + n.x * 9} ${y2 - 12 * sin + n.y * 9} L ${x2} ${y2} L ${x2 - 12 * cos - n.x * 9} ${y2 - 12 * sin - n.y * 9}`}
            {...common}
            className="mol-stroke"
          />
        </g>
      )
    }
    case 'equilibrium': {
      const o = 4
      return (
        <g>
          <line x1={r.x} y1={r.y - o} x2={x2} y2={y2 - o} {...common} className="mol-stroke" transform={`rotate(0)`} />
          {head(x2, y2 - o, 1, 'up')}
          <line x1={r.x} y1={r.y + o} x2={x2} y2={y2 + o} {...common} className="mol-stroke" />
          {head(r.x, r.y + o, -1, 'down')}
        </g>
      )
    }
    case 'resonance':
      return (
        <g>
          <line x1={r.x} y1={r.y} x2={x2} y2={y2} {...common} className="mol-stroke" />
          {head(x2, y2, 1)}
          {head(r.x, r.y, -1)}
        </g>
      )
    default:
      return null
  }
}

function ConditionsEditor({
  r,
  onClose,
}: {
  r: Reaction
  onClose: () => void
}) {
  const [top, setTop] = useState(r.conditionsTop ?? '')
  const [bottom, setBottom] = useState(r.conditionsBottom ?? '')
  const commitEdit = () => {
    updateReaction(r.id, { conditionsTop: top.trim() || undefined, conditionsBottom: bottom.trim() || undefined })
    onClose()
  }
  const mx = r.x + (r.length / 2) * Math.cos(r.angle ?? 0)
  const my = r.y + (r.length / 2) * Math.sin(r.angle ?? 0)
  return (
    <foreignObject x={mx - 90} y={my - 58} width={180} height={116}>
      <div className="flex flex-col gap-1 rounded-[6px] border border-edge-strong bg-panel p-1.5 shadow-lg">
        <input
          autoFocus
          value={top}
          onChange={(e) => setTop(e.target.value)}
          placeholder="above (reagents)"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') onClose()
          }}
          className="h-6 rounded-[4px] border border-edge bg-toolbar px-1.5 text-[11px] text-primary focus:outline-none"
        />
        <input
          value={bottom}
          onChange={(e) => setBottom(e.target.value)}
          placeholder="below (conditions)"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') onClose()
          }}
          className="h-6 rounded-[4px] border border-edge bg-toolbar px-1.5 text-[11px] text-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={commitEdit}
          className="h-6 rounded-[4px] bg-accent-subtle text-[11px] text-accent hover:opacity-80"
        >
          Done
        </button>
      </div>
    </foreignObject>
  )
}

function ArrowView({ r }: { r: Reaction }) {
  const [editing, setEditing] = useState(false)
  const [dragOff, setDragOff] = useState<{ dx: number; dy: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  const isCurly = r.kind === 'curly' && r.x2 !== undefined
  const ang = r.angle ?? 0
  const x2 = isCurly ? r.x2! : r.x + r.length * Math.cos(ang)
  const y2 = isCurly ? r.y2! : r.y + r.length * Math.sin(ang)
  const mx = (r.x + x2) / 2
  const my = (r.y + y2) / 2

  const view = () => useEditorStore.getState().view
  const toWorldDelta = (dxScreen: number, dyScreen: number) => {
    const z = view().zoom
    return { dx: dxScreen / z, dy: dyScreen / z }
  }

  const shifted = dragOff ? { ...r, x: r.x + dragOff.dx, y: r.y + dragOff.dy, x2: r.x2 !== undefined ? r.x2 + dragOff.dx : undefined, y2: r.y2 !== undefined ? r.y2 + dragOff.dy : undefined } : r

  return (
    <g>
      <ArrowGlyph r={shifted} stroke="var(--stroke-mol)" />
      {shifted.conditionsTop && (
        <text
          x={mx + (dragOff?.dx ?? 0)}
          y={my + (dragOff?.dy ?? 0) - 12}
          textAnchor="middle"
          fontSize={12}
          fontFamily="var(--font-ui)"
          fill="var(--stroke-mol)"
          className="select-none"
        >
          {shifted.conditionsTop}
        </text>
      )}
      {shifted.conditionsBottom && (
        <text
          x={mx + (dragOff?.dx ?? 0)}
          y={my + (dragOff?.dy ?? 0) + 20}
          textAnchor="middle"
          fontSize={12}
          fontFamily="var(--font-ui)"
          fill="var(--text-secondary)"
          className="select-none"
        >
          {shifted.conditionsBottom}
        </text>
      )}
      {/* generous hit target */}
      <line
        x1={shifted.x}
        y1={shifted.y}
        x2={x2 + (dragOff?.dx ?? 0)}
        y2={y2 + (dragOff?.dy ?? 0)}
        stroke="transparent"
        strokeWidth={16 / view().zoom}
        style={{ cursor: 'move' }}
        data-arrow={r.id}
        onPointerDown={(e) => {
          if (useEditorStore.getState().tool !== 'select' || e.button !== 0) return
          e.stopPropagation()
          dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (!d) return
          const { dx, dy } = toWorldDelta(e.clientX - d.startX, e.clientY - d.startY)
          if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true
          setDragOff({ dx, dy })
        }}
        onPointerUp={(e) => {
          const d = dragRef.current
          dragRef.current = null
          if (d && d.moved) {
            const { dx, dy } = toWorldDelta(e.clientX - d.startX, e.clientY - d.startY)
            updateReaction(r.id, {
              x: r.x + dx,
              y: r.y + dy,
              x2: r.x2 !== undefined ? r.x2 + dx : undefined,
              y2: r.y2 !== undefined ? r.y2 + dy : undefined,
            })
          }
          setDragOff(null)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!isCurly) setEditing(true)
        }}
      />
      {editing && <ConditionsEditor r={r} onClose={() => setEditing(false)} />}
    </g>
  )
}

export default function ReactionLayer() {
  const reactions = useDocStore((s) => s.reactions)
  return (
    <>
      {reactions.map((r) => (
        <ArrowView key={r.id} r={r} />
      ))}
    </>
  )
}

export function eraseArrowIfHit(target: Element): boolean {
  const id = target.getAttribute?.('data-arrow')
  if (id) {
    deleteReaction(id)
    return true
  }
  return false
}
