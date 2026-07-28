import { memo, useMemo } from 'react'
import { stereoTagsForMolblock } from '../chem/properties'
import { isRDKitReady } from '../chem/rdkit'
import { elementColor } from '../model/elements'
import { moleculeToMolblock, neighborsOf } from '../model/graph'
import type { Atom, Bond, Molecule } from '../model/types'
import { useChemIssues } from '../state/chemIssues'
import { useDocStore } from '../state/doc'
import { useEditorStore } from '../state/editor'
import { useUIStore, type DisplayOptions } from '../state/store'

const LABEL_GAP = 9 // bond gap around a labeled atom, world px
const DOUBLE_OFFSET = 5.6
const TRIPLE_OFFSET = 5.2

/** Is this atom drawn with a text label (vs. a bare skeletal vertex)? */
export function atomIsLabeled(
  atom: Atom,
  degree: number,
  mode: DisplayOptions['atomLabels'] = 'hetero',
): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return degree === 0
  return (
    atom.element !== 'C' ||
    atom.charge !== 0 ||
    atom.isotope !== undefined ||
    (atom.radical ?? 0) > 0 ||
    degree === 0 ||
    atom.abbreviation !== undefined
  )
}

interface P {
  x: number
  y: number
}

function sub(a: P, b: P): P {
  return { x: a.x - b.x, y: a.y - b.y }
}
function norm(a: P): P {
  const l = Math.hypot(a.x, a.y) || 1
  return { x: a.x / l, y: a.y / l }
}
function perp(a: P): P {
  return { x: -a.y, y: a.x }
}
function cross(a: P, b: P): number {
  return a.x * b.y - a.y * b.x
}

function BondView({
  mol,
  bond,
  labeled,
  selected,
  zoom,
  display,
  dimmed,
}: {
  mol: Molecule
  bond: Bond
  labeled: ReadonlySet<string>
  selected: boolean
  zoom: number
  display: DisplayOptions
  dimmed: boolean
}) {
  const a1 = mol.atoms.find((a) => a.id === bond.a1)
  const a2 = mol.atoms.find((a) => a.id === bond.a2)
  if (!a1 || !a2) return null

  const dir = norm(sub(a2, a1))
  const n = perp(dir)
  const gap1 = labeled.has(a1.id) ? LABEL_GAP : 0
  const gap2 = labeled.has(a2.id) ? LABEL_GAP : 0
  const p1: P = { x: a1.x + dir.x * gap1, y: a1.y + dir.y * gap1 }
  const p2: P = { x: a2.x - dir.x * gap2, y: a2.y - dir.y * gap2 }
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)

  const lines: React.ReactNode[] = []
  const stroke = 'var(--stroke-mol)'
  const common = {
    stroke,
    strokeWidth: display.lineWidth,
    strokeLinecap: 'round' as const,
    className: 'mol-stroke',
  }

  const stereo = bond.stereo ?? 'none'

  if (stereo === 'wedge') {
    // Solid triangle, narrow at a1
    const wHalf = 3.8
    lines.push(
      <polygon
        key="w"
        points={`${p1.x},${p1.y} ${p2.x + n.x * wHalf},${p2.y + n.y * wHalf} ${p2.x - n.x * wHalf},${p2.y - n.y * wHalf}`}
        fill={stroke}
        className="mol-stroke-fill"
      />,
    )
  } else if (stereo === 'dash') {
    // Hashed wedge, narrow at a1
    const ticks = 7
    for (let i = 0; i < ticks; i++) {
      const t = i / (ticks - 1)
      const w = 0.8 + t * 3.2
      const cx = p1.x + (p2.x - p1.x) * t
      const cy = p1.y + (p2.y - p1.y) * t
      lines.push(
        <line
          key={`d${i}`}
          x1={cx + n.x * w}
          y1={cy + n.y * w}
          x2={cx - n.x * w}
          y2={cy - n.y * w}
          {...common}
          strokeWidth={1.5}
        />,
      )
    }
  } else if (stereo === 'wavy') {
    const waves = Math.max(3, Math.round(len / 8))
    let d = `M ${p1.x} ${p1.y}`
    for (let i = 0; i < waves; i++) {
      const t0 = i / waves
      const t1 = (i + 0.5) / waves
      const t2 = (i + 1) / waves
      const side = i % 2 === 0 ? 1 : -1
      const mx = p1.x + (p2.x - p1.x) * t1 + n.x * 3.4 * side
      const my = p1.y + (p2.y - p1.y) * t1 + n.y * 3.4 * side
      const ex = p1.x + (p2.x - p1.x) * t2
      const ey = p1.y + (p2.y - p1.y) * t2
      d += ` Q ${mx} ${my} ${ex} ${ey}`
      void t0
    }
    lines.push(<path key="wv" d={d} fill="none" {...common} strokeWidth={1.5} />)
  } else if (bond.order === 1) {
    lines.push(<line key="1" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...common} />)
  } else if (bond.order === 2 || bond.order === 'aromatic') {
    // Pick the inner-line side: toward the neighbors' centroid
    const nb1 = neighborsOf(mol, a1.id).filter((id) => id !== a2.id)
    const nb2 = neighborsOf(mol, a2.id).filter((id) => id !== a1.id)
    const others = [...nb1, ...nb2]
      .map((id) => mol.atoms.find((a) => a.id === id))
      .filter((a): a is Atom => !!a)
    if (others.length === 0) {
      // Terminal double bond (e.g. C=O): symmetric twin lines
      const o = DOUBLE_OFFSET / 2
      lines.push(
        <line key="a" x1={p1.x + n.x * o} y1={p1.y + n.y * o} x2={p2.x + n.x * o} y2={p2.y + n.y * o} {...common} />,
        <line key="b" x1={p1.x - n.x * o} y1={p1.y - n.y * o} x2={p2.x - n.x * o} y2={p2.y - n.y * o} {...common} />,
      )
    } else {
      let sideSum = 0
      for (const o of others) sideSum += Math.sign(cross(dir, sub(o, a1)))
      const side = sideSum >= 0 ? 1 : -1
      const off = DOUBLE_OFFSET * side
      const trim = Math.min(len * 0.15, 8)
      const q1: P = { x: p1.x + dir.x * trim + n.x * off, y: p1.y + dir.y * trim + n.y * off }
      const q2: P = { x: p2.x - dir.x * trim + n.x * off, y: p2.y - dir.y * trim + n.y * off }
      lines.push(<line key="a" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...common} />)
      lines.push(
        <line
          key="b"
          x1={q1.x}
          y1={q1.y}
          x2={q2.x}
          y2={q2.y}
          {...common}
          strokeDasharray={bond.order === 'aromatic' ? '4.5 3.5' : undefined}
        />,
      )
    }
  } else if (bond.order === 3) {
    lines.push(
      <line key="a" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...common} />,
      <line
        key="b"
        x1={p1.x + n.x * TRIPLE_OFFSET}
        y1={p1.y + n.y * TRIPLE_OFFSET}
        x2={p2.x + n.x * TRIPLE_OFFSET}
        y2={p2.y + n.y * TRIPLE_OFFSET}
        {...common}
      />,
      <line
        key="c"
        x1={p1.x - n.x * TRIPLE_OFFSET}
        y1={p1.y - n.y * TRIPLE_OFFSET}
        x2={p2.x - n.x * TRIPLE_OFFSET}
        y2={p2.y - n.y * TRIPLE_OFFSET}
        {...common}
      />,
    )
  }

  const hitW = Math.max(12 / zoom, 6)
  return (
    <g opacity={dimmed ? 0.25 : 1}>
      {selected && (
        <line
          x1={a1.x}
          y1={a1.y}
          x2={a2.x}
          y2={a2.y}
          stroke="var(--accent)"
          strokeWidth={Math.max(9, hitW)}
          strokeLinecap="round"
          opacity={0.3}
        />
      )}
      {lines}
      <line
        x1={a1.x}
        y1={a1.y}
        x2={a2.x}
        y2={a2.y}
        stroke="transparent"
        strokeWidth={hitW}
        strokeLinecap="round"
        style={{ cursor: 'pointer' }}
        data-bond={bond.id}
        data-mol={mol.id}
      />
    </g>
  )
}

function AtomView({
  mol,
  atom,
  degree,
  meanDx,
  selected,
  zoom,
  display,
  dimmed,
  hovered,
  issue,
}: {
  mol: Molecule
  atom: Atom
  degree: number
  meanDx: number
  selected: boolean
  zoom: number
  display: DisplayOptions
  dimmed: boolean
  hovered: boolean
  issue: string | undefined
}) {
  const LABEL_FONT = display.labelSize
  const labeled = atomIsLabeled(atom, degree, display.atomLabels)
  const color = display.colorScheme === 'mono' ? 'var(--stroke-mol)' : elementColor(atom.element)
  const impH = display.showImplicitH ? (atom.implicitH ?? 0) : 0
  const hitR = Math.max(10 / zoom, 7)

  let label: React.ReactNode = null
  if (labeled) {
    const hLeft = impH > 0 && meanDx > 0.3
    const symbol = atom.abbreviation ?? atom.element
    const chargeText =
      display.showCharges && atom.charge !== 0
        ? `${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ''}${atom.charge > 0 ? '+' : '−'}`
        : null
    label = (
      <text
        x={atom.x}
        y={atom.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={LABEL_FONT}
        fontFamily="var(--font-ui)"
        fontWeight={500}
        fill={color}
        stroke="var(--canvas)"
        strokeWidth={4}
        paintOrder="stroke"
        style={{ userSelect: 'none' }}
      >
        {atom.isotope !== undefined && (
          <tspan fontSize={LABEL_FONT * 0.72} baselineShift="35%">
            {atom.isotope}
          </tspan>
        )}
        {hLeft && impH > 0 && (
          <>
            <tspan>H</tspan>
            {impH > 1 && (
              <tspan fontSize={LABEL_FONT * 0.72} baselineShift="-25%">
                {impH}
              </tspan>
            )}
          </>
        )}
        <tspan>{symbol}</tspan>
        {!hLeft && impH > 0 && (
          <>
            <tspan>H</tspan>
            {impH > 1 && (
              <tspan fontSize={LABEL_FONT * 0.72} baselineShift="-25%">
                {impH}
              </tspan>
            )}
          </>
        )}
        {chargeText && (
          <tspan fontSize={LABEL_FONT * 0.72} baselineShift="35%">
            {chargeText}
          </tspan>
        )}
      </text>
    )
  }

  return (
    <g opacity={dimmed ? 0.25 : 1}>
      {selected && (
        <circle cx={atom.x} cy={atom.y} r={Math.max(13, hitR + 3)} fill="var(--accent)" opacity={0.25} />
      )}
      {hovered && !selected && (
        <circle
          cx={atom.x}
          cy={atom.y}
          r={hitR}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2 / zoom}
          opacity={0.6}
        />
      )}
      {label}
      {issue && (
        <g>
          <circle cx={atom.x + 10} cy={atom.y - 10} r={3.2} fill="var(--warning)">
            <title>{issue}</title>
          </circle>
        </g>
      )}
      {(atom.radical ?? 0) > 0 && (
        <>
          <circle cx={atom.x - (atom.radical === 2 ? 4 : 0)} cy={atom.y - 13} r={1.6} fill={color} />
          {atom.radical === 2 && <circle cx={atom.x + 4} cy={atom.y - 13} r={1.6} fill={color} />}
        </>
      )}
      <circle
        cx={atom.x}
        cy={atom.y}
        r={hitR}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        data-atom={atom.id}
        data-mol={mol.id}
      />
    </g>
  )
}

const MoleculeView = memo(function MoleculeView({
  mol: molRaw,
  zoom,
  selection,
  display,
  dragOffset,
  pendingErase,
  hoverAtomId,
  issues,
}: {
  mol: Molecule
  zoom: number
  selection: { atomIds: ReadonlySet<string>; bondIds: ReadonlySet<string> }
  display: DisplayOptions
  dragOffset: { dx: number; dy: number } | null
  pendingErase: ReadonlySet<string>
  hoverAtomId: string | null
  issues: ReadonlyMap<string, string>
}) {
  // While moving a selection, shift the affected atoms visually; the document
  // itself is only mutated once, on drop.
  let mol = molRaw
  if (dragOffset) {
    const movingBondEnds = new Set<string>()
    for (const b of molRaw.bonds) {
      if (selection.bondIds.has(b.id)) {
        movingBondEnds.add(b.a1)
        movingBondEnds.add(b.a2)
      }
    }
    const moving = (id: string) => selection.atomIds.has(id) || movingBondEnds.has(id)
    if (molRaw.atoms.some((a) => moving(a.id))) {
      mol = {
        ...molRaw,
        atoms: molRaw.atoms.map((a) =>
          moving(a.id) ? { ...a, x: a.x + dragOffset.dx, y: a.y + dragOffset.dy } : a,
        ),
      }
    }
  }
  const degree = new Map<string, number>()
  const bondDirs = new Map<string, { dx: number; n: number }>()
  for (const b of mol.bonds) {
    degree.set(b.a1, (degree.get(b.a1) ?? 0) + 1)
    degree.set(b.a2, (degree.get(b.a2) ?? 0) + 1)
    const a1 = mol.atoms.find((a) => a.id === b.a1)
    const a2 = mol.atoms.find((a) => a.id === b.a2)
    if (a1 && a2) {
      const d = norm(sub(a2, a1))
      const e1 = bondDirs.get(b.a1) ?? { dx: 0, n: 0 }
      e1.dx += d.x
      e1.n++
      bondDirs.set(b.a1, e1)
      const e2 = bondDirs.get(b.a2) ?? { dx: 0, n: 0 }
      e2.dx += -d.x
      e2.n++
      bondDirs.set(b.a2, e2)
    }
  }

  const labeledSet = new Set<string>()
  for (const a of mol.atoms) {
    if (atomIsLabeled(a, degree.get(a.id) ?? 0, display.atomLabels)) labeledSet.add(a.id)
  }

  // CIP stereo labels (RDKit): recomputed when the molecule object changes
  const stereoTags = useMemo(() => {
    if (!display.showStereo || !isRDKitReady()) return null
    try {
      return stereoTagsForMolblock(moleculeToMolblock(molRaw))
    } catch {
      return null
    }
  }, [molRaw, display.showStereo])

  return (
    <g data-molecule={mol.id}>
      {mol.bonds.map((b) => (
        <BondView
          key={b.id}
          mol={mol}
          bond={b}
          labeled={labeledSet}
          selected={selection.bondIds.has(b.id)}
          zoom={zoom}
          display={display}
          dimmed={pendingErase.has(b.id) || pendingErase.has(b.a1) || pendingErase.has(b.a2)}
        />
      ))}
      {stereoTags &&
        mol.atoms.map((a, i) => {
          const tag = stereoTags.atoms.get(i)
          if (!tag) return null
          return (
            <text
              key={`st-${a.id}`}
              x={a.x + 11}
              y={a.y - 11}
              fontSize={9.5}
              fontStyle="italic"
              fontFamily="var(--font-ui)"
              fill="var(--text-secondary)"
              className="select-none"
            >
              ({tag})
            </text>
          )
        })}
      {stereoTags &&
        mol.bonds.map((b) => {
          const i1 = mol.atoms.findIndex((a) => a.id === b.a1)
          const i2 = mol.atoms.findIndex((a) => a.id === b.a2)
          const tag = stereoTags.bonds.get(i1 * 100000 + i2)
          if (!tag) return null
          const a1 = mol.atoms[i1]
          const a2 = mol.atoms[i2]
          return (
            <text
              key={`sb-${b.id}`}
              x={(a1.x + a2.x) / 2 + 10}
              y={(a1.y + a2.y) / 2 - 10}
              fontSize={9.5}
              fontStyle="italic"
              fontFamily="var(--font-ui)"
              fill="var(--text-secondary)"
              className="select-none"
            >
              ({tag})
            </text>
          )
        })}
      {mol.atoms.map((a) => {
        const dirs = bondDirs.get(a.id)
        return (
          <AtomView
            key={a.id}
            mol={mol}
            atom={a}
            degree={degree.get(a.id) ?? 0}
            meanDx={dirs && dirs.n > 0 ? dirs.dx / dirs.n : 0}
            selected={selection.atomIds.has(a.id)}
            zoom={zoom}
            display={display}
            dimmed={pendingErase.has(a.id)}
            hovered={hoverAtomId === a.id}
            issue={issues.get(a.id)}
          />
        )
      })}
    </g>
  )
})

export default function MoleculeLayer() {
  const molecules = useDocStore((s) => s.molecules)
  const zoom = useEditorStore((s) => s.view.zoom)
  const selection = useEditorStore((s) => s.selection)
  const dragOffset = useEditorStore((s) => s.dragOffset)
  const pendingErase = useEditorStore((s) => s.pendingErase)
  const hoverAtomId = useEditorStore((s) => s.hover.atomId)
  const display = useUIStore((s) => s.display)
  const issues = useChemIssues((s) => s.issues)

  return (
    <>
      {molecules.map((m) => (
        <MoleculeView
          key={m.id}
          mol={m}
          zoom={zoom}
          selection={selection}
          display={display}
          dragOffset={dragOffset}
          pendingErase={pendingErase}
          hoverAtomId={hoverAtomId}
          issues={issues}
        />
      ))}
    </>
  )
}
