import { useState } from 'react'
import type { Bracket } from '../model/types'
import { useDocStore } from '../state/doc'
import { updateBracket } from '../state/docActions'

/** Polymer/Markush brackets (§7.7) with an editable subscript. */

function BracketPath({ b }: { b: Bracket }) {
  const s = 'var(--stroke-mol)'
  const common = { stroke: s, strokeWidth: 1.6, fill: 'none', className: 'mol-stroke' }
  const arm = 10
  if (b.style === 'square') {
    return (
      <g>
        <path d={`M ${b.x + arm} ${b.y} L ${b.x} ${b.y} L ${b.x} ${b.y + b.h} L ${b.x + arm} ${b.y + b.h}`} {...common} />
        <path
          d={`M ${b.x + b.w - arm} ${b.y} L ${b.x + b.w} ${b.y} L ${b.x + b.w} ${b.y + b.h} L ${b.x + b.w - arm} ${b.y + b.h}`}
          {...common}
        />
      </g>
    )
  }
  if (b.style === 'round') {
    return (
      <g>
        <path d={`M ${b.x + arm} ${b.y} Q ${b.x} ${b.y} ${b.x} ${b.y + b.h / 2} Q ${b.x} ${b.y + b.h} ${b.x + arm} ${b.y + b.h}`} {...common} />
        <path
          d={`M ${b.x + b.w - arm} ${b.y} Q ${b.x + b.w} ${b.y} ${b.x + b.w} ${b.y + b.h / 2} Q ${b.x + b.w} ${b.y + b.h} ${b.x + b.w - arm} ${b.y + b.h}`}
          {...common}
        />
      </g>
    )
  }
  // curly
  const mY = b.y + b.h / 2
  return (
    <g>
      <path
        d={`M ${b.x + arm} ${b.y} Q ${b.x} ${b.y} ${b.x + 2} ${mY - 6} L ${b.x - 4} ${mY} L ${b.x + 2} ${mY + 6} Q ${b.x} ${b.y + b.h} ${b.x + arm} ${b.y + b.h}`}
        {...common}
      />
      <path
        d={`M ${b.x + b.w - arm} ${b.y} Q ${b.x + b.w} ${b.y} ${b.x + b.w - 2} ${mY - 6} L ${b.x + b.w + 4} ${mY} L ${b.x + b.w - 2} ${mY + 6} Q ${b.x + b.w} ${b.y + b.h} ${b.x + b.w - arm} ${b.y + b.h}`}
        {...common}
      />
    </g>
  )
}

function BracketView({ b }: { b: Bracket }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(b.label ?? '')
  return (
    <g data-bracket={b.id}>
      <BracketPath b={b} />
      {b.label && !editing && (
        <text
          x={b.x + b.w + 6}
          y={b.y + b.h + 4}
          fontSize={11}
          fontFamily="var(--font-ui)"
          fontStyle="italic"
          fill="var(--stroke-mol)"
          style={{ cursor: 'text', userSelect: 'none' }}
          data-bracket={b.id}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setDraft(b.label ?? '')
            setEditing(true)
          }}
        >
          {b.label}
        </text>
      )}
      {/* invisible hit area on the right bracket for double-click edit */}
      <rect
        x={b.x + b.w - 8}
        y={b.y}
        width={16}
        height={b.h}
        fill="transparent"
        data-bracket={b.id}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(b.label ?? '')
          setEditing(true)
        }}
      />
      {editing && (
        <foreignObject x={b.x + b.w + 2} y={b.y + b.h - 12} width={72} height={28}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateBracket(b.id, { label: draft.trim() || undefined })
                setEditing(false)
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => setEditing(false)}
            className="h-6 w-full rounded-[4px] border border-edge-strong bg-panel px-1 text-[11px] text-primary focus:outline-none"
          />
        </foreignObject>
      )}
    </g>
  )
}

export default function BracketLayer() {
  const brackets = useDocStore((s) => s.brackets)
  return (
    <>
      {brackets.map((b) => (
        <BracketView key={b.id} b={b} />
      ))}
    </>
  )
}
