import { create } from 'zustand'
import { generateConformer, type Conformer } from '../chem/conformer'
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
  conformer: Conformer | null
  /** Formula-ish label shown in the AR heads-up display. */
  title: string
  close: () => void
}

export const useARStore = create<ARState>((set) => ({
  open: false,
  conformer: null,
  title: '',
  close: () => set({ open: false, conformer: null, title: '' }),
}))

/** The molecule AR should show: the selection, else the only structure. */
export function arTarget(): Molecule | null {
  const frag = selectedFragment()
  if (frag && frag.atoms.length > 0) return frag
  const { molecules } = useDocStore.getState()
  if (molecules.length === 1) return molecules[0]
  return null
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
  if (mol.atoms.length > 220) {
    toast('That structure is too large for the AR viewer.', 'error')
    return
  }

  try {
    const conformer = generateConformer(mol)
    if (conformer.atoms.length === 0) {
      toast('Could not build a 3D shape for this structure.', 'error')
      return
    }
    useARStore.setState({ open: true, conformer, title: describe(mol) })
  } catch {
    toast('Could not build a 3D shape for this structure.', 'error')
  }
}
