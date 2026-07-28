import { X } from 'lucide-react'
import { useUIStore } from '../state/store'
import { useDocStore } from '../state/doc'

/**
 * Newman projection view (§7.5), rendered SVG for a chosen bond.
 * 2D drawings carry no torsion information, so substituents are shown in the
 * standard staggered arrangement — stated plainly in the caption. Chemistry
 * honesty over fake precision.
 */
export default function ProjectionView() {
  const bondId = useUIStore((s) => s.projectionBond)
  const close = () => useUIStore.getState().setProjectionBond(null)
  const molecules = useDocStore((s) => s.molecules)

  if (!bondId) return null
  const mol = molecules.find((m) => m.bonds.some((b) => b.id === bondId))
  const bond = mol?.bonds.find((b) => b.id === bondId)
  if (!mol || !bond) return null

  const front = mol.atoms.find((a) => a.id === bond.a1)!
  const back = mol.atoms.find((a) => a.id === bond.a2)!
  const subsOf = (atomId: string, excludeId: string) =>
    mol.bonds
      .filter((b) => (b.a1 === atomId || b.a2 === atomId) && b.id !== bond.id)
      .map((b) => (b.a1 === atomId ? b.a2 : b.a1))
      .filter((id) => id !== excludeId)
      .map((id) => mol.atoms.find((a) => a.id === id)!)
      .slice(0, 3)

  const frontSubs = subsOf(front.id, back.id)
  const backSubs = subsOf(back.id, front.id)

  const label = (a: { element: string; implicitH?: number } | undefined, fallback: string) => {
    if (!a) return fallback
    const h = a.implicitH ?? 0
    return h > 0 ? `${a.element}H${h > 1 ? h : ''}` : a.element
  }

  const cx = 130
  const cy = 120
  const R = 34
  const L = 62
  // Front bonds at 12, 4, 8 o'clock; back at 2, 6, 10 (staggered)
  const frontAngles = [-90, 30, 150]
  const backAngles = [-30, 90, 210]

  const line = (angDeg: number, fromR: number, toR: number, key: string) => {
    const a = (angDeg * Math.PI) / 180
    return (
      <line
        key={key}
        x1={cx + Math.cos(a) * fromR}
        y1={cy + Math.sin(a) * fromR}
        x2={cx + Math.cos(a) * toR}
        y2={cy + Math.sin(a) * toR}
        stroke="var(--stroke-mol)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    )
  }
  const subLabel = (angDeg: number, text: string, key: string) => {
    const a = (angDeg * Math.PI) / 180
    return (
      <text
        key={key}
        x={cx + Math.cos(a) * (L + 14)}
        y={cy + Math.sin(a) * (L + 14)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontFamily="var(--font-ui)"
        fill="var(--stroke-mol)"
      >
        {text}
      </text>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={close}>
      <div
        className="w-[300px] rounded-[10px] border border-edge-strong bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Newman projection"
      >
        <div className="flex items-center justify-between pb-1">
          <span className="text-[15px] font-medium text-primary">Newman projection</span>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-primary"
          >
            <X size={14} />
          </button>
        </div>
        <svg width={260} height={240} className="mx-auto block">
          {/* back bonds first (from circle edge outward) */}
          {backAngles.map((a, i) => (backSubs[i] ? line(a, R, L, `bb${i}`) : null))}
          {backAngles.map((a, i) => (backSubs[i] ? subLabel(a, label(backSubs[i], 'H'), `bl${i}`) : null))}
          {backAngles.map((a, i) => (!backSubs[i] ? [line(a, R, L, `bbh${i}`), subLabel(a, 'H', `blh${i}`)] : null))}
          <circle cx={cx} cy={cy} r={R} fill="var(--canvas)" stroke="var(--stroke-mol)" strokeWidth={1.8} />
          {/* front bonds from the center */}
          {frontAngles.map((a, i) => (frontSubs[i] ? line(a, 0, L, `fb${i}`) : null))}
          {frontAngles.map((a, i) => (frontSubs[i] ? subLabel(a, label(frontSubs[i], 'H'), `fl${i}`) : null))}
          {frontAngles.map((a, i) => (!frontSubs[i] ? [line(a, 0, L, `fbh${i}`), subLabel(a, 'H', `flh${i}`)] : null))}
          <circle cx={cx} cy={cy} r={2.5} fill="var(--stroke-mol)" />
        </svg>
        <p className="pt-1 text-[11px] leading-relaxed text-muted">
          Looking down the {label(front, '?')}–{label(back, '?')} bond. Shown staggered by
          convention — a 2D drawing carries no torsion information.
        </p>
      </div>
    </div>
  )
}
