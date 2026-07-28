import { Check, Copy, Crosshair, Tag, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  propertiesFromMolblock,
  stereoTagsForMolblock,
  type MolProperties,
} from '../chem/properties'
import { checkSmiles } from '../chem/smiles'
import { ELEMENTS } from '../model/elements'
import { docBounds, moleculeToMolblock } from '../model/graph'
import type { Atom, Bond, Molecule } from '../model/types'
import { useDocStore } from '../state/doc'
import {
  cleanUpMolecules,
  deleteItems,
  replaceMoleculeFromSmiles,
  setBondOrder,
  setBondStereo,
  updateAtom,
} from '../state/docActions'
import { useEditorStore } from '../state/editor'
import { identifySelection } from '../state/identify'
import { useUIStore, type DisplayOptions } from '../state/store'
import { toast } from './Toasts'

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:bg-hover hover:text-primary"
    >
      {done ? <Check size={11} className="text-success" /> : <Copy size={11} />}
    </button>
  )
}

function Field({ label, mono = true, value, children }: { label: string; mono?: boolean; value?: string; children?: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11px] tracking-wide text-muted uppercase">{label}</span>
        {value !== undefined && <CopyBtn value={value} label={label} />}
      </div>
      <div className={`${mono ? 'font-mono text-[12px]' : 'text-[13px]'} break-all text-primary`}>
        {children ?? value}
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</div>
  )
}

function FormulaText({ parts }: { parts: MolProperties['formula'] }) {
  return (
    <span className="font-mono text-[13px]">
      {parts.map((p, i) =>
        p.sub ? <sub key={i}>{p.text}</sub> : p.sup ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>,
      )}
    </span>
  )
}

function MoleculeSection({ mol }: { mol: Molecule }) {
  const [smilesDraft, setSmilesDraft] = useState<string | null>(null)

  const data = useMemo(() => {
    try {
      const mb = moleculeToMolblock(mol)
      return { props: propertiesFromMolblock(mb), error: null as string | null }
    } catch (err) {
      return { props: null, error: err instanceof Error ? err.message : 'unparseable structure' }
    }
  }, [mol])

  if (!data.props) {
    return (
      <div className="px-4 py-2 text-[12px] text-warning">
        RDKit can't interpret this structure yet ({data.error}). Fix the flagged valence issues to
        see its properties.
      </div>
    )
  }
  const p = data.props
  const totalMass = Object.entries(p.composition).reduce(
    (s, [el, n]) => s + (ELEMENTS[el]?.mass ?? 0) * n,
    0,
  )

  const draftCheck = smilesDraft !== null ? checkSmiles(smilesDraft) : null

  return (
    <div className="border-t border-edge px-4 py-2">
      <SectionHeader>Molecule</SectionHeader>
      <Field label="Formula" value={p.formulaText}>
        <FormulaText parts={p.formula} />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="MW" value={p.mw.toFixed(4)}>
          {p.mw.toFixed(4)}
        </Field>
        <Field label="Exact mass" value={p.exactMass.toFixed(6)}>
          {p.exactMass.toFixed(6)}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Unsaturation">{p.unsaturation.toFixed(1)}</Field>
        <Field label="Rings">{String(p.ringCount)}</Field>
      </div>

      <div className="py-1">
        <span className="text-[11px] tracking-wide text-muted uppercase">Composition</span>
        <table className="mt-1 w-full font-mono text-[11px] text-secondary">
          <tbody>
            {Object.entries(p.composition).map(([el, n]) => (
              <tr key={el} className="border-b border-edge last:border-0">
                <td className="py-0.5 text-primary">{el}</td>
                <td className="py-0.5 text-right">{n}</td>
                <td className="py-0.5 text-right">
                  {totalMass > 0 ? (((ELEMENTS[el]?.mass ?? 0) * n * 100) / totalMass).toFixed(1) : '0.0'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">SMILES · editable</span>
          <CopyBtn value={p.smiles} label="SMILES" />
        </div>
        <input
          value={smilesDraft ?? p.smiles}
          onChange={(e) => setSmilesDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && smilesDraft !== null) {
              if (replaceMoleculeFromSmiles(mol.id, smilesDraft.trim())) {
                setSmilesDraft(null)
                toast('Structure re-rendered from SMILES.', 'success')
              } else {
                toast('Invalid SMILES — structure unchanged.', 'error')
              }
            }
            if (e.key === 'Escape') setSmilesDraft(null)
          }}
          onBlur={() => setSmilesDraft(null)}
          spellCheck={false}
          className={`mt-1 w-full rounded-[6px] border bg-toolbar px-2 py-1 font-mono text-[11px] text-primary focus:outline-none ${
            draftCheck ? (draftCheck.valid ? 'border-success' : 'border-danger') : 'border-edge'
          }`}
        />
        {draftCheck && (
          <div className={`mt-0.5 text-[11px] ${draftCheck.valid ? 'text-success' : 'text-danger'}`}>
            {draftCheck.valid ? `↵ to re-render — ${draftCheck.formulaText}` : 'not a valid SMILES yet'}
          </div>
        )}
      </div>

      {p.inchi && (
        <Field label="InChI" value={p.inchi}>
          <span className="line-clamp-3">{p.inchi}</span>
        </Field>
      )}
      {p.inchiKey && <Field label="InChIKey" value={p.inchiKey} />}

      <button
        type="button"
        onClick={() => identifySelection()}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-edge bg-toolbar py-1.5 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
      >
        <Tag size={13} /> Name this structure
      </button>

      <button
        type="button"
        onClick={() => {
          const n = cleanUpMolecules(new Set([mol.id]))
          if (n > 0) toast('Structure cleaned up.', 'success')
        }}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-edge bg-toolbar py-1.5 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
      >
        <Wand2 size={13} /> Clean up structure
      </button>
    </div>
  )
}

/** First-order hybridization from bond orders (display heuristic). */
function hybridization(mol: Molecule, atom: Atom): string {
  if (!['C', 'N', 'O', 'S', 'P', 'B', 'Si'].includes(atom.element)) return '—'
  let doubles = 0
  let triples = 0
  let aromatic = 0
  for (const b of mol.bonds) {
    if (b.a1 !== atom.id && b.a2 !== atom.id) continue
    if (b.order === 2) doubles++
    else if (b.order === 3) triples++
    else if (b.order === 'aromatic') aromatic++
  }
  if (triples > 0 || doubles >= 2) return 'sp'
  if (doubles === 1 || aromatic > 0) return 'sp²'
  return 'sp³'
}

function AtomSection({ mol, atom }: { mol: Molecule; atom: Atom }) {
  const info = ELEMENTS[atom.element]
  const stereo = useMemo(() => {
    try {
      return stereoTagsForMolblock(moleculeToMolblock(mol))
    } catch {
      return { atoms: new Map<number, string>(), bonds: new Map<number, string>() }
    }
  }, [mol])
  const atomIdx = mol.atoms.findIndex((a) => a.id === atom.id)
  const rs = stereo.atoms.get(atomIdx)

  return (
    <div className="border-t border-edge px-4 py-2">
      <SectionHeader>
        Atom · {atom.element}
        {info ? ` (${info.name})` : ''}
      </SectionHeader>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Atomic number">{info ? String(info.z) : '?'}</Field>
        <Field label="Atomic mass">{info ? info.mass.toFixed(3) : '?'}</Field>
        <Field label="Implicit H">{String(atom.implicitH ?? 0)}</Field>
        <Field label="Hybridization">{hybridization(mol, atom)}</Field>
        {rs && <Field label="Chirality">({rs})</Field>}
        {atom.isotope !== undefined && <Field label="Isotope">{String(atom.isotope)}</Field>}
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-[11px] tracking-wide text-muted uppercase">Formal charge</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Decrease charge"
            onClick={() => updateAtom(atom.id, { charge: atom.charge - 1 })}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-secondary hover:bg-hover hover:text-primary"
          >
            −
          </button>
          <span className="min-w-[28px] text-center font-mono text-[12px] text-primary">
            {atom.charge > 0 ? `+${atom.charge}` : atom.charge}
          </span>
          <button
            type="button"
            aria-label="Increase charge"
            onClick={() => updateAtom(atom.id, { charge: atom.charge + 1 })}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-secondary hover:bg-hover hover:text-primary"
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => deleteItems(new Set([atom.id]), new Set())}
        className="mt-1 w-full rounded-[6px] border border-edge py-1.5 text-[12px] text-danger transition-colors duration-150 hover:bg-hover"
      >
        Delete atom
      </button>
    </div>
  )
}

function BondSection({ mol, bond }: { mol: Molecule; bond: Bond }) {
  const a1 = mol.atoms.find((a) => a.id === bond.a1)
  const a2 = mol.atoms.find((a) => a.id === bond.a2)
  const lengthA = a1 && a2 ? Math.hypot(a1.x - a2.x, a1.y - a2.y) / 40 : 0
  const stereo = useMemo(() => {
    try {
      return stereoTagsForMolblock(moleculeToMolblock(mol))
    } catch {
      return { atoms: new Map<number, string>(), bonds: new Map<number, string>() }
    }
  }, [mol])
  const i1 = mol.atoms.findIndex((a) => a.id === bond.a1)
  const i2 = mol.atoms.findIndex((a) => a.id === bond.a2)
  const ez = stereo.bonds.get(i1 * 100000 + i2)

  return (
    <div className="border-t border-edge px-4 py-2">
      <SectionHeader>Bond</SectionHeader>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Order">{bond.order === 'aromatic' ? 'aromatic' : String(bond.order)}</Field>
        <Field label="Length">{`${lengthA.toFixed(2)} Å`}</Field>
        <Field label="Stereo mark">{bond.stereo && bond.stereo !== 'none' ? bond.stereo : '—'}</Field>
        {ez && <Field label="Config">({ez})</Field>}
      </div>
      <div className="flex gap-1 py-1">
        {([1, 2, 3] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setBondOrder(bond.id, o)}
            className={`flex-1 rounded-[6px] border py-1 text-[12px] transition-colors duration-150 ${
              bond.order === o
                ? 'border-accent bg-accent-subtle text-accent'
                : 'border-edge text-secondary hover:bg-hover hover:text-primary'
            }`}
          >
            {o === 1 ? 'Single' : o === 2 ? 'Double' : 'Triple'}
          </button>
        ))}
      </div>
      <div className="flex gap-1 pb-1">
        {(['wedge', 'dash', 'wavy'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setBondStereo(bond.id, s)}
            className={`flex-1 rounded-[6px] border py-1 text-[12px] capitalize transition-colors duration-150 ${
              bond.stereo === s
                ? 'border-accent bg-accent-subtle text-accent'
                : 'border-edge text-secondary hover:bg-hover hover:text-primary'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => deleteItems(new Set(), new Set([bond.id]))}
        className="mt-1 w-full rounded-[6px] border border-edge py-1.5 text-[12px] text-danger transition-colors duration-150 hover:bg-hover"
      >
        Delete bond
      </button>
    </div>
  )
}

const selectCls =
  'h-6 rounded-[6px] border border-edge bg-toolbar px-1.5 text-[12px] text-primary focus:outline-none'

function DisplaySection() {
  const display = useUIStore((s) => s.display)
  const setDisplay = useUIStore((s) => s.setDisplay)
  const molecules = useDocStore((s) => s.molecules)
  const fitView = useEditorStore((s) => s.fitView)

  return (
    <div className="border-t border-edge px-4 py-3">
      <SectionHeader>Display</SectionHeader>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Atom labels</span>
        <select
          className={selectCls}
          value={display.atomLabels}
          onChange={(e) => setDisplay({ atomLabels: e.target.value as DisplayOptions['atomLabels'] })}
        >
          <option value="hetero">Heteroatoms</option>
          <option value="all">All atoms</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Color scheme</span>
        <select
          className={selectCls}
          value={display.colorScheme}
          onChange={(e) => setDisplay({ colorScheme: e.target.value as DisplayOptions['colorScheme'] })}
        >
          <option value="cpk">CPK</option>
          <option value="mono">Monochrome</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Line width · {display.lineWidth.toFixed(1)}</span>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.1}
          value={display.lineWidth}
          onChange={(e) => setDisplay({ lineWidth: parseFloat(e.target.value) })}
          className="w-[96px] accent-(--accent)"
          aria-label="Bond line width"
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Label size · {display.labelSize.toFixed(1)}</span>
        <input
          type="range"
          min={8}
          max={18}
          step={0.5}
          value={display.labelSize}
          onChange={(e) => setDisplay({ labelSize: parseFloat(e.target.value) })}
          className="w-[96px] accent-(--accent)"
          aria-label="Atom label font size"
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Stereo labels</span>
        <input
          type="checkbox"
          checked={display.showStereo}
          onChange={(e) => setDisplay({ showStereo: e.target.checked })}
          className="h-3.5 w-3.5 accent-(--accent)"
          aria-label="Show R/S and E/Z labels"
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1 text-[13px] text-secondary">
        <span>Formal charges</span>
        <input
          type="checkbox"
          checked={display.showCharges}
          onChange={(e) => setDisplay({ showCharges: e.target.checked })}
          className="h-3.5 w-3.5 accent-(--accent)"
          aria-label="Show formal charges"
        />
      </label>
      <button
        type="button"
        onClick={() => fitView(docBounds(molecules))}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-edge bg-toolbar py-1.5 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
      >
        <Crosshair size={13} /> Auto-center
      </button>
    </div>
  )
}

export default function RightPanel() {
  const rightOpen = useUIStore((s) => s.rightOpen)
  const molecules = useDocStore((s) => s.molecules)
  const selection = useEditorStore((s) => s.selection)

  const atomCount = molecules.reduce((n, m) => n + m.atoms.length, 0)
  const bondCount = molecules.reduce((n, m) => n + m.bonds.length, 0)

  // Contextual resolution (§5.4): single atom → atom panel; single bond → bond
  // panel; otherwise the enclosing/only molecule; otherwise whole-canvas stats.
  let atomTarget: { mol: Molecule; atom: Atom } | null = null
  let bondTarget: { mol: Molecule; bond: Bond } | null = null
  let molTarget: Molecule | null = null

  if (selection.atomIds.size === 1 && selection.bondIds.size === 0) {
    const id = [...selection.atomIds][0]
    for (const m of molecules) {
      const a = m.atoms.find((x) => x.id === id)
      if (a) {
        atomTarget = { mol: m, atom: a }
        molTarget = m
        break
      }
    }
  } else if (selection.bondIds.size === 1 && selection.atomIds.size === 0) {
    const id = [...selection.bondIds][0]
    for (const m of molecules) {
      const b = m.bonds.find((x) => x.id === id)
      if (b) {
        bondTarget = { mol: m, bond: b }
        molTarget = m
        break
      }
    }
  } else if (selection.atomIds.size > 0 || selection.bondIds.size > 0) {
    const withSel = molecules.filter(
      (m) =>
        m.atoms.some((a) => selection.atomIds.has(a.id)) ||
        m.bonds.some((b) => selection.bondIds.has(b.id)),
    )
    if (withSel.length === 1) molTarget = withSel[0]
  } else if (molecules.length === 1) {
    molTarget = molecules[0]
  }

  return (
    <aside
      aria-label="Properties"
      aria-hidden={!rightOpen}
      className="no-print shrink-0 overflow-hidden border-l border-edge bg-panel transition-[width] duration-200"
      style={{ width: rightOpen ? 264 : 0 }}
    >
      <div className="flex h-full w-[264px] flex-col overflow-y-auto">
        <div className="px-4 pt-4 pb-2 text-[15px] font-medium text-primary">Properties</div>
        <div className="space-y-1 px-4 pb-2 text-[13px] text-secondary">
          <div className="flex justify-between">
            <span>Structures</span>
            <span className="font-mono text-primary">{molecules.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Atoms</span>
            <span className="font-mono text-primary">{atomCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Bonds</span>
            <span className="font-mono text-primary">{bondCount}</span>
          </div>
        </div>

        {atomTarget && <AtomSection mol={atomTarget.mol} atom={atomTarget.atom} />}
        {bondTarget && <BondSection mol={bondTarget.mol} bond={bondTarget.bond} />}
        {molTarget && <MoleculeSection mol={molTarget} />}
        <DisplaySection />
      </div>
    </aside>
  )
}
