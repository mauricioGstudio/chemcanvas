import { create } from 'zustand'
import { identifyStructure, type Identification } from '../chem/identify'
import { moleculeToMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { toast } from '../ui/Toasts'
import { selectedFragment } from './clipboard'
import { useDocStore } from './doc'

/**
 * Shared state for the Name-this-structure dialog, so the command palette,
 * context menu, keyboard shortcut and properties panel all drive one result.
 */

interface IdentifyState {
  open: boolean
  loading: boolean
  /** Formula of what was looked up, shown while the request is in flight. */
  subject: string | null
  result: Identification | null
  close: () => void
}

export const useIdentifyStore = create<IdentifyState>((set) => ({
  open: false,
  loading: false,
  subject: null,
  result: null,
  close: () => {
    controller?.abort()
    controller = null
    set({ open: false, loading: false, result: null, subject: null })
  },
}))

let controller: AbortController | null = null

/** Atom count summary, e.g. "14 atoms" — a stand-in label while loading. */
function describe(mol: Molecule): string {
  return `${mol.atoms.length} atom${mol.atoms.length === 1 ? '' : 's'}`
}

/**
 * Resolve what to name: an explicit selection wins, otherwise the only
 * structure on the canvas. Returns null (with a toast) when ambiguous.
 */
function targetMolecule(): Molecule | null {
  const frag = selectedFragment()
  if (frag && frag.atoms.length > 0) return frag
  const { molecules } = useDocStore.getState()
  if (molecules.length === 1) return molecules[0]
  if (molecules.length === 0) {
    toast('Draw or search for a structure first.', 'info')
    return null
  }
  toast('Select a structure first — several are on the canvas.', 'info')
  return null
}

/** Look up a name for the selected structure and open the result dialog. */
export function identifySelection() {
  const mol = targetMolecule()
  if (!mol) return

  controller?.abort()
  controller = new AbortController()
  const { signal } = controller

  useIdentifyStore.setState({
    open: true,
    loading: true,
    result: null,
    subject: describe(mol),
  })

  let molblock: string
  try {
    molblock = moleculeToMolblock(mol)
  } catch {
    useIdentifyStore.setState({ loading: false, result: { status: 'invalid' } })
    return
  }

  identifyStructure(molblock, signal)
    .then((result) => {
      if (signal.aborted) return
      useIdentifyStore.setState({ loading: false, result })
    })
    .catch((err) => {
      if ((err as Error)?.name === 'AbortError') return
      useIdentifyStore.setState({ loading: false, result: { status: 'network' } })
    })
}
