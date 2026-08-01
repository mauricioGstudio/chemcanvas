import { create } from 'zustand'
import { generateConformer, type Conformer } from '../chem/conformer'
import { fetchConformer3D, precise3DEnabled } from '../chem/conformer3d'
import { getRDKit } from '../chem/rdkit'
import { moleculeToMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { toast } from '../ui/Toasts'
import { selectedFragment } from './clipboard'
import { useDocStore } from './doc'

/**
 * State for the AR viewer. The conformer is generated once when AR opens
 * (it's the expensive step) and reused for the whole session.
 */

interface ARState {
  open: boolean
  /** True while the 3D structure is being built. */
  building: boolean
  conformer: Conformer | null
  /** True when the geometry came from the structure service, not local rules. */
  precise: boolean
  /** Formula-ish label shown in the AR heads-up display. */
  title: string
  close: () => void
}

export const useARStore = create<ARState>((set) => ({
  open: false,
  building: false,
  conformer: null,
  precise: false,
  title: '',
  close: () =>
    set({ open: false, building: false, conformer: null, precise: false, title: '' }),
}))

/** The molecule AR should show: the selection, else the only structure. */
export function arTarget(): Molecule | null {
  const frag = selectedFragment()
  if (frag && frag.atoms.length > 0) return frag
  const { molecules } = useDocStore.getState()
  if (molecules.length === 1) return molecules[0]
  return null
}

/**
 * Every structure on the canvas, so AR can offer a switcher instead of
 * making the user leave, reselect, and come back.
 */
export function arMolecules(): { id: string; label: string; mol: Molecule }[] {
  return useDocStore
    .getState()
    .molecules.map((mol) => ({ id: mol.id, label: describe(mol), mol }))
}

/** Swap the AR view to a different structure without leaving AR. */
export function setARMolecule(entry: { mol: Molecule; label: string }) {
  useARStore.setState({ building: true, conformer: null, precise: false, title: entry.label })
  buildInto(entry.mol)
}

function describe(mol: Molecule): string {
  const counts: Record<string, number> = {}
  for (const a of mol.atoms) counts[a.element] = (counts[a.element] ?? 0) + 1
  const order = Object.keys(counts).sort((a, b) =>
    a === 'C' ? -1 : b === 'C' ? 1 : a.localeCompare(b),
  )
  return order.map((el) => `${el}${counts[el] > 1 ? counts[el] : ''}`).join('')
}

/** Build the 3D conformer and open the AR view. */
export function openAR() {
  const mol = arTarget()
  if (!mol) {
    const { molecules } = useDocStore.getState()
    toast(
      molecules.length === 0
        ? 'Draw or search for a structure first.'
        : 'Select a structure first — several are on the canvas.',
      'info',
    )
    return
  }
  if (mol.atoms.length > 600) {
    toast(`That structure is too large for the AR viewer (${mol.atoms.length} atoms).`, 'error')
    return
  }

  // Open first, build second. Generating a big structure takes up to a
  // second or so, and doing it before the overlay exists reads as the app
  // freezing rather than working.
  useARStore.setState({ open: true, building: true, conformer: null, title: describe(mol) })
  buildInto(mol)
}

/**
 * Build geometry for `mol` and hand it to the viewer.
 *
 * Local generation runs first so something is on screen immediately, then a
 * properly embedded structure is fetched and swapped in if one is available.
 * That way the viewer never waits on the network, and never depends on it.
 */
function buildInto(mol: Molecule) {
  const run = async () => {
    let local: Conformer | null = null
    try {
      local = generateConformer(mol)
    } catch {
      local = null
    }
    if (!useARStore.getState().open) return

    if (!local || local.atoms.length === 0) {
      useARStore.getState().close()
      toast('Could not build a 3D shape for this structure.', 'error')
      return
    }
    useARStore.setState({ building: false, conformer: local, precise: false })

    if (!precise3DEnabled()) return
    const smiles = moleculeSmiles(mol)
    if (!smiles) return
    const better = await fetchConformer3D(smiles)
    if (!better) return
    // Ignore a late reply if the user has moved on.
    const st = useARStore.getState()
    if (!st.open || st.conformer !== local) return
    useARStore.setState({ conformer: better, precise: true })
  }

  // Let the overlay paint before doing the heavy work. Prefer a frame
  // callback, but fall back to a timer: requestAnimationFrame is paused in
  // background tabs, and the structure should still build if the user
  // opened AR and switched away.
  let started = false
  const kick = () => {
    if (started) return
    started = true
    void run()
  }
  requestAnimationFrame(() => requestAnimationFrame(kick))
  setTimeout(kick, 120)
}

/** Canonical SMILES for a molecule, or null if RDKit can't read it. */
function moleculeSmiles(mol: Molecule): string | null {
  try {
    const RDKit = getRDKit()
    const m = RDKit.get_mol(moleculeToMolblock(mol))
    if (!m) return null
    try {
      return m.get_smiles() || null
    } finally {
      m.delete()
    }
  } catch {
    return null
  }
}
