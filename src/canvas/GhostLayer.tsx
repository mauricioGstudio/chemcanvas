import { elementColor } from '../model/elements'
import { useEditorStore } from '../state/editor'

/**
 * Live cursor previews (§5.2): faint ghost of whatever the active tool would
 * place — pending bond rubber-band, ring outline, chain, atom symbol — plus
 * marquee/lasso feedback. Everything here is pointer-events: none.
 */
export default function GhostLayer() {
  const tool = useEditorStore((s) => s.tool)
  const cursor = useEditorStore((s) => s.cursor)
  const hover = useEditorStore((s) => s.hover)
  const currentElement = useEditorStore((s) => s.currentElement)
  const bondGhost = useEditorStore((s) => s.bondGhost)
  const chainGhost = useEditorStore((s) => s.chainGhost)
  const ringGhost = useEditorStore((s) => s.ringGhost)
  const marquee = useEditorStore((s) => s.marquee)
  const lasso = useEditorStore((s) => s.lasso)
  const zoom = useEditorStore((s) => s.view.zoom)

  const ghostStroke = 'var(--accent)'
  const items: React.ReactNode[] = []

  if (bondGhost) {
    items.push(
      <g key="bond" opacity={0.55}>
        <line
          x1={bondGhost.from.x}
          y1={bondGhost.from.y}
          x2={bondGhost.to.x}
          y2={bondGhost.to.y}
          stroke={ghostStroke}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        <circle
          cx={bondGhost.to.x}
          cy={bondGhost.to.y}
          r={bondGhost.toAtomId ? 8 : 3}
          fill={bondGhost.toAtomId ? 'none' : ghostStroke}
          stroke={bondGhost.toAtomId ? ghostStroke : 'none'}
          strokeWidth={1.5}
        />
      </g>,
    )
  }

  if (chainGhost && chainGhost.length > 0) {
    const d = chainGhost.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const last = chainGhost[chainGhost.length - 1]
    items.push(
      <g key="chain" opacity={0.55}>
        <path d={d} fill="none" stroke={ghostStroke} strokeWidth={1.8} strokeLinejoin="round" />
        <text
          x={last.x + 12 / zoom}
          y={last.y - 12 / zoom}
          fontSize={12 / zoom < 4 ? 12 : 12 / zoom}
          fill={ghostStroke}
          fontFamily="var(--font-mono)"
        >
          C{chainGhost.length}
        </text>
      </g>,
    )
  }

  if (ringGhost) {
    const pos = new Map(ringGhost.atoms.map((a) => [a.id, a]))
    items.push(
      <g key="ring" opacity={0.5}>
        {ringGhost.bonds.map((b) => {
          const a1 = pos.get(b.a1)!
          const a2 = pos.get(b.a2)!
          return (
            <line
              key={b.id}
              x1={a1.x}
              y1={a1.y}
              x2={a2.x}
              y2={a2.y}
              stroke={ghostStroke}
              strokeWidth={1.8}
              strokeDasharray={b.order === 2 ? undefined : undefined}
            />
          )
        })}
        {ringGhost.atoms
          .filter((a) => a.element !== 'C')
          .map((a) => (
            <text
              key={a.id}
              x={a.x}
              y={a.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fill={ghostStroke}
              fontFamily="var(--font-ui)"
            >
              {a.element}
            </text>
          ))}
      </g>,
    )
  }

  // Atom-tool cursor preview over empty canvas
  if (tool === 'atom' && cursor && !hover.atomId && !bondGhost) {
    items.push(
      <text
        key="atom-ghost"
        x={cursor.x}
        y={cursor.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13.5}
        fontFamily="var(--font-ui)"
        fontWeight={500}
        fill={elementColor(currentElement)}
        opacity={0.45}
      >
        {currentElement}
      </text>,
    )
  }

  // Eraser radius indicator
  if (tool === 'eraser' && cursor) {
    items.push(
      <circle
        key="eraser"
        cx={cursor.x}
        cy={cursor.y}
        r={12 / zoom < 8 ? 8 : 12 / zoom}
        fill="none"
        stroke="var(--error)"
        strokeWidth={1 / zoom}
        opacity={0.6}
      />,
    )
  }

  if (marquee) {
    items.push(
      <rect
        key="marquee"
        x={Math.min(marquee.x1, marquee.x2)}
        y={Math.min(marquee.y1, marquee.y2)}
        width={Math.abs(marquee.x2 - marquee.x1)}
        height={Math.abs(marquee.y2 - marquee.y1)}
        fill="var(--accent-subtle)"
        stroke="var(--accent)"
        strokeWidth={1 / zoom}
      />,
    )
  }

  if (lasso && lasso.length > 1) {
    items.push(
      <path
        key="lasso"
        d={lasso.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'}
        fill="var(--accent-subtle)"
        stroke="var(--accent)"
        strokeWidth={1 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      />,
    )
  }

  return <g className="pointer-events-none">{items}</g>
}
