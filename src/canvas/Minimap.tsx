import { useRef } from 'react'
import { docBounds } from '../model/graph'
import { useDocStore } from '../state/doc'
import { useEditorStore } from '../state/editor'
import { padBox, unionBox, type Box } from './view'

const MAP_W = 168
const MAP_H = 112

/**
 * Bottom-right overview map. Shows the union of content bounds and the current
 * viewport; dragging or clicking recenters the view on that world point.
 */
export default function Minimap() {
  const view = useEditorStore((s) => s.view)
  const viewport = useEditorStore((s) => s.viewport)
  const molecules = useDocStore((s) => s.molecules)
  const dragging = useRef(false)

  if (viewport.w === 0) return null
  const contentBounds: Box | null = docBounds(molecules)

  // Viewport rect in world coords
  const vpBox: Box = {
    minX: -view.x / view.zoom,
    minY: -view.y / view.zoom,
    maxX: (viewport.w - view.x) / view.zoom,
    maxY: (viewport.h - view.y) / view.zoom,
  }
  const world = padBox(unionBox(contentBounds, vpBox)!, 40)
  const scale = Math.min(MAP_W / (world.maxX - world.minX), MAP_H / (world.maxY - world.minY))
  const ox = (MAP_W - (world.maxX - world.minX) * scale) / 2
  const oy = (MAP_H - (world.maxY - world.minY) * scale) / 2

  const toMap = (wx: number, wy: number) => ({
    x: ox + (wx - world.minX) * scale,
    y: oy + (wy - world.minY) * scale,
  })
  const vpTL = toMap(vpBox.minX, vpBox.minY)
  const vpBR = toMap(vpBox.maxX, vpBox.maxY)

  const recenter = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const wx = world.minX + (mx - ox) / scale
    const wy = world.minY + (my - oy) / scale
    const { view: v, viewport: vp, setView } = useEditorStore.getState()
    setView({ zoom: v.zoom, x: vp.w / 2 - wx * v.zoom, y: vp.h / 2 - wy * v.zoom })
  }

  return (
    <div
      className="no-print absolute right-4 bottom-4 overflow-hidden rounded-[10px] border border-edge bg-panel/85 shadow-lg backdrop-blur-sm"
      aria-label="Minimap"
    >
      <svg
        width={MAP_W}
        height={MAP_H}
        className="block cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          recenter(e)
        }}
        onPointerMove={(e) => dragging.current && recenter(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        {molecules.map((m) =>
          m.atoms.map((a) => {
            const p = toMap(a.x, a.y)
            return <circle key={a.id} cx={p.x} cy={p.y} r={1.2} fill="var(--text-muted)" />
          }),
        )}
        <rect
          x={vpTL.x}
          y={vpTL.y}
          width={Math.max(vpBR.x - vpTL.x, 4)}
          height={Math.max(vpBR.y - vpTL.y, 4)}
          fill="var(--accent-subtle)"
          stroke="var(--accent)"
          strokeWidth={1}
          rx={2}
        />
      </svg>
    </div>
  )
}
