import { useEffect, useRef, useState } from 'react'
import { checkSmiles } from '../chem/smiles'
import { docBounds } from '../model/graph'
import { placeStructureFromSmiles } from '../state/actions'
import { copySelection } from '../state/clipboard'
import { useDocStore } from '../state/doc'
import {
  cleanUpMolecules,
  cycleAtomCharge,
  deleteItems,
  findAtom,
  setAtomElement,
  setBondOrder,
  setBondStereo,
  updateAtom,
} from '../state/docActions'
import { useEditorStore } from '../state/editor'
import { identifySelection } from '../state/identify'
import { useUIStore } from '../state/store'
import { ABBREVIATIONS } from '../model/abbreviations'
import {
  autoLayoutReaction,
  bracketSelection,
  expandAbbreviation,
  fischerLayout,
  invertStereocenter,
  setAbbreviation,
} from '../state/docActions'
import { toast } from './Toasts'

const QUICK_ELEMENTS = ['C', 'N', 'O', 'S', 'F', 'Cl', 'Br']

function Item({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  const close = () => useEditorStore.getState().setContextMenu(null)
  return (
    <button
      type="button"
      onClick={() => {
        onClick()
        close()
      }}
      className={`w-full rounded-[4px] px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-hover ${
        danger ? 'text-danger' : 'text-secondary hover:text-primary'
      }`}
    >
      {label}
    </button>
  )
}

function Divider() {
  return <div className="my-1 h-px bg-(--border)" />
}

export default function ContextMenu() {
  const menu = useEditorStore((s) => s.contextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [isoInput, setIsoInput] = useState('')

  useEffect(() => {
    setIsoInput('')
    if (!menu) return
    const close = () => useEditorStore.getState().setContextMenu(null)
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!menu) return null
  const editor = useEditorStore.getState()

  const copyMoleculeSmiles = (atomId: string) => {
    const found = findAtom(atomId)
    if (!found) return
    editor.select({
      atomIds: found.mol.atoms.map((a) => a.id),
      bondIds: found.mol.bonds.map((b) => b.id),
    })
    void copySelection()
  }

  let body: React.ReactNode = null
  if (menu.kind === 'atom' && menu.targetId) {
    const atomId = menu.targetId
    const found = findAtom(atomId)
    body = (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[11px] tracking-wide text-muted uppercase">
          Atom {found ? `· ${found.atom.element}` : ''}
        </div>
        <div className="flex gap-0.5 px-1.5 pb-1">
          {QUICK_ELEMENTS.map((el) => (
            <button
              key={el}
              type="button"
              onClick={() => {
                setAtomElement(atomId, el)
                editor.setContextMenu(null)
              }}
              className={`flex h-6 w-6 items-center justify-center rounded-[4px] text-[12px] font-medium transition-colors duration-150 ${
                found?.atom.element === el
                  ? 'bg-accent-subtle text-accent'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
            >
              {el}
            </button>
          ))}
        </div>
        <Divider />
        <Item label={`Charge + (now ${found?.atom.charge ?? 0})`} onClick={() => updateAtom(atomId, { charge: (found?.atom.charge ?? 0) + 1 })} />
        <Item label="Charge −" onClick={() => updateAtom(atomId, { charge: (found?.atom.charge ?? 0) - 1 })} />
        <Item label="Cycle charge 0/+1/+2/−1/−2" onClick={() => cycleAtomCharge(atomId)} />
        <Item
          label={found?.atom.radical ? 'Remove radical' : 'Make radical'}
          onClick={() => updateAtom(atomId, { radical: found?.atom.radical ? 0 : 1 })}
        />
        <form
          className="flex items-center gap-1.5 px-2.5 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            const v = parseInt(isoInput, 10)
            updateAtom(atomId, { isotope: Number.isFinite(v) && v > 0 ? v : undefined })
            editor.setContextMenu(null)
          }}
        >
          <span className="text-[12px] text-secondary">Isotope</span>
          <input
            value={isoInput}
            onChange={(e) => setIsoInput(e.target.value)}
            placeholder={found?.atom.isotope ? String(found.atom.isotope) : '—'}
            className="h-6 w-14 rounded-[4px] border border-edge bg-toolbar px-1.5 font-mono text-[12px] text-primary focus:outline-none"
          />
          <button type="submit" className="rounded-[4px] border border-edge px-1.5 py-0.5 text-[11px] text-secondary hover:bg-hover">
            Set
          </button>
        </form>
        <Divider />
        {found && !found.atom.abbreviation && (
          <div className="px-2.5 py-1">
            <div className="pb-1 text-[11px] text-muted">Abbreviate as…</div>
            <div className="flex flex-wrap gap-0.5">
              {ABBREVIATIONS.slice(0, 12).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setAbbreviation(atomId, a.label)
                    editor.setContextMenu(null)
                  }}
                  className="rounded-[4px] border border-edge px-1 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {found?.atom.abbreviation && (
          <Item
            label={`Expand ${found.atom.abbreviation}`}
            onClick={() => {
              if (!expandAbbreviation(atomId)) toast('Only terminal superatoms can expand.', 'error')
            }}
          />
        )}
        {found && found.mol.bonds.some((b) => b.a1 === atomId && (b.stereo === 'wedge' || b.stereo === 'dash')) && (
          <Item
            label="Invert stereocenter"
            onClick={() => invertStereocenter(atomId)}
          />
        )}
        <Item
          label="Fischer layout (molecule)"
          onClick={() => {
            if (found && !fischerLayout(found.mol.id))
              toast('Fischer layout needs an acyclic chain.', 'error')
          }}
        />
        <Divider />
        <Item
          label="Name this structure…"
          onClick={() => {
            if (found)
              editor.select({
                atomIds: found.mol.atoms.map((a) => a.id),
                bondIds: found.mol.bonds.map((b) => b.id),
              })
            identifySelection()
          }}
        />
        <Item label="Copy fragment SMILES" onClick={() => copyMoleculeSmiles(atomId)} />
        <Item label="Delete atom" danger onClick={() => deleteItems(new Set([atomId]), new Set())} />
      </>
    )
  } else if (menu.kind === 'bond' && menu.targetId) {
    const bondId = menu.targetId
    body = (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[11px] tracking-wide text-muted uppercase">Bond</div>
        <Item label="Single" onClick={() => setBondOrder(bondId, 1)} />
        <Item label="Double" onClick={() => setBondOrder(bondId, 2)} />
        <Item label="Triple" onClick={() => setBondOrder(bondId, 3)} />
        <Divider />
        <Item label="Wedge (toward viewer)" onClick={() => setBondStereo(bondId, 'wedge')} />
        <Item label="Dashed wedge (away)" onClick={() => setBondStereo(bondId, 'dash')} />
        <Item label="Wavy (undefined)" onClick={() => setBondStereo(bondId, 'wavy')} />
        <Item label="Flip wedge direction" onClick={() => setBondStereo(bondId, 'wedge')} />
        <Divider />
        <Item
          label="Newman projection…"
          onClick={() => useUIStore.getState().setProjectionBond(bondId)}
        />
        <Divider />
        <Item label="Delete bond" danger onClick={() => deleteItems(new Set(), new Set([bondId]))} />
      </>
    )
  } else {
    body = (
      <>
        <Item
          label="Paste SMILES from clipboard"
          onClick={() => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                const check = checkSmiles(text.trim())
                if (check.isSmiles && check.valid) placeStructureFromSmiles(text.trim())
                else toast('Clipboard does not contain a valid SMILES string.', 'error')
              })
              .catch(() => toast('Clipboard unavailable.', 'error'))
          }}
        />
        <Item
          label="Select all"
          onClick={() => {
            const molecules = useDocStore.getState().molecules
            editor.select({
              atomIds: molecules.flatMap((m) => m.atoms.map((a) => a.id)),
              bondIds: molecules.flatMap((m) => m.bonds.map((b) => b.id)),
            })
          }}
        />
        <Item
          label="Clean up structures"
          onClick={() => {
            const n = cleanUpMolecules()
            if (n > 0) toast(`Cleaned up ${n} structure${n > 1 ? 's' : ''}.`, 'success')
          }}
        />
        <Item
          label="Zoom to fit"
          onClick={() => editor.fitView(docBounds(useDocStore.getState().molecules))}
        />
        <Item
          label="Auto-layout reaction"
          onClick={() => {
            if (!autoLayoutReaction()) toast('Draw a reaction arrow first.', 'info')
          }}
        />
        <Item
          label="Bracket selection [ ]ₙ"
          onClick={() => {
            if (!bracketSelection('square', 'n')) toast('Select some atoms first.', 'info')
          }}
        />
      </>
    )
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-[210px] rounded-[10px] border border-edge-strong bg-panel p-1 shadow-2xl"
      style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 320) }}
    >
      {body}
    </div>
  )
}
