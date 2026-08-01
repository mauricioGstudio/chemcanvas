import { create } from 'zustand'
import { generateConformer, type Conformer } from '../chem/conformer'
import { fetchConformer3D, precise3DEnabled } from '../chem/conformer3d'
import { getRDKit } from '../chem/rdkit'
import { moleculeToMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { toast } from '../ui/Toasts'
import { useDocStore } from './doc'

/**
 * State for the AR viewer. Opening AR now brings in every structure on the
 * canvas at once, laid out side by side — there is no more "select a
 * molecule, then open AR" step. Which one you're manipulating is decided
 * inside the viewer, by pinching (or clicking) it.
 */

export interface AREntry {
  id: string
  label: string
  conformer: Conformer
  precise: boolean
}

interface ARState {
  open: boolean
  /** True while local geometry is still being generated. */
  building: boolean
  buildDone: number
  buildTotal: number
  entries: AREntry[]
  /** The molecule currently picked for manipulation, or null for none. */
  focusedId: string | null
  close: () => void
  setFocus: (id: string | null) => void
}

const TOTAL_ATOM_BUDGET = 900

export const useARStore = create<ARState>((set) => ({
  open: false,
  building: false,
  buildDone: 0,
  buildTotal: 0,
  entries: [],
  focusedId: null,
  close: () =>
    set({
      open: false,
      building: false,
      buildDone: 0,
      buildTotal: 0,
      entries: [],
      focusedId: null,
    }),
  setFocus: (focusedId) => set({ focusedId }),
}))

function describe(mol: Molecule): string {
  const counts: Record<string, number> = {}
  for (const a of mol.atoms) counts[a.element] = (counts[a.element] ?? 0) + 1
  const order = Object.keys(counts).sort((a, b) =>
    a === 'C' ? -1 : b === 'C' ? 1 : a.localeCompare(b),
  )
  return order.map((el) => `${el}${counts[el] > 1 ? counts[el] : ''}`).join('')
}

/** Left-to-right doc-space position, so the AR row matches the canvas layout. */
function centroidX(mol: Molecule): number {
  if (mol.atoms.length === 0) return 0
  return mol.atoms.reduce((s, a) => s + a.x, 0) / mol.atoms.length
}

/**
 * Bring every structure on the canvas into AR. `focusMoleculeId` optionally
 * pre-focuses one (used when AR is opened from a specific molecule's
 * right-click menu).
 */
export function openAR(focusMoleculeId?: string) {
  const { molecules } = useDocStore.getState()
  if (molecules.length === 0) {
    toast('Draw or search for a structure first.', 'info')
    return
  }
  const totalAtoms = molecules.reduce((n, m) => n + m.atoms.length, 0)
  if (totalAtoms > TOTAL_ATOM_BUDGET) {
    toast(`That's too much for the AR viewer at once (${totalAtoms} atoms on the canvas).`, 'error')
    return
  }

  const ordered = [...molecules].sort((a, b) => centroidX(a) - centroidX(b))
  useARStore.setState({
    open: true,
    building: true,
    buildDone: 0,
    buildTotal: ordered.length,
    entries: [],
    focusedId: null,
  })

  let started = false
  const kick = () => {
    if (started) return
    started = true
    void buildAll(ordered, focusMoleculeId)
  }
  // Let the overlay paint before doing the heavy work. Prefer a frame
  // callback, but fall back to a timer: requestAnimationFrame is paused in
  // background tabs, and the build should still run if the user opened AR
  // and switched away.
  requestAnimationFrame(() => requestAnimationFrame(kick))
  setTimeout(kick, 120)
}

/**
 * Build local geometry for every molecule first — reporting progress as it
 * goes — then upgrade each to precise geometry in the background if that's
 * enabled. Local generation never waits on the network; precise geometry
 * never blocks the viewer from opening.
 *
 * `entries` in the store is intentionally left empty until every molecule
 * is done, updating only `buildDone` in between. The viewer treats
 * `entries.length > 0` as "ready to show a scene" — if entries filled in
 * one at a time, that condition would go true after the *first* molecule,
 * and the scene would construct (with the camera framed for one molecule)
 * while the rest were still streaming in behind a progress bar that claims
 * nothing is ready yet.
 */
async function buildAll(ordered: Molecule[], focusMoleculeId?: string) {
  const built: AREntry[] = []

  for (let i = 0; i < ordered.length; i++) {
    if (!useARStore.getState().open) return // closed mid-build
    const mol = ordered[i]
    let conformer: Conformer | null = null
    try {
      conformer = generateConformer(mol)
    } catch {
      conformer = null
    }
    if (conformer && conformer.atoms.length > 0) {
      built.push({ id: mol.id, label: describe(mol), conformer, precise: false })
    }
    useARStore.setState({ buildDone: i + 1 })
    // Yield so the progress bar actually paints between molecules instead
    // of the whole row appearing to jump from 0 to done.
    await new Promise((r) => setTimeout(r, 0))
  }

  if (!useARStore.getState().open) return
  if (built.length === 0) {
    useARStore.getState().close()
    toast('Could not build a 3D shape for anything on the canvas.', 'error')
    return
  }
  useARStore.setState({
    building: false,
    entries: built,
    focusedId: focusMoleculeId && built.some((e) => e.id === focusMoleculeId) ? focusMoleculeId : null,
  })

  if (!precise3DEnabled()) return
  for (const entry of built) {
    if (!useARStore.getState().open) return
    const mol = ordered.find((m) => m.id === entry.id)
    if (!mol) continue
    const smiles = moleculeSmiles(mol)
    if (!smiles) continue
    const better = await fetchConformer3D(smiles)
    if (!better || !useARStore.getState().open) continue
    useARStore.setState((s) => ({
      entries: s.entries.map((e) => (e.id === entry.id ? { ...e, conformer: better, precise: true } : e)),
    }))
  }
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
