import { getRDKit } from '../chem/rdkit'
import { moleculeToMolblock, newId } from '../model/graph'
import { cloneMolecule } from '../model/templates'
import type { Molecule } from '../model/types'
import { toast } from '../ui/Toasts'
import { useDocStore } from './doc'
import { deleteItems } from './docActions'
import { placeMolecule } from './docActions'
import { useEditorStore } from './editor'

/**
 * Copy / cut / duplicate for canvas selections. The clipboard payload is a
 * SMILES string (via RDKit), so copied fragments paste into any chemistry
 * tool — and back into ChemCanvas through the existing SMILES paste path.
 */

/** The selected subgraph as one (possibly disconnected) molecule, or null. */
export function selectedFragment(): Molecule | null {
  const { selection } = useEditorStore.getState()
  const atomIds = new Set(selection.atomIds)
  // Selected bonds pull in their endpoint atoms
  for (const m of useDocStore.getState().molecules) {
    for (const b of m.bonds) {
      if (selection.bondIds.has(b.id)) {
        atomIds.add(b.a1)
        atomIds.add(b.a2)
      }
    }
  }
  if (atomIds.size === 0) return null
  const atoms = []
  const bonds = []
  for (const m of useDocStore.getState().molecules) {
    for (const a of m.atoms) if (atomIds.has(a.id)) atoms.push(a)
    for (const b of m.bonds) if (atomIds.has(b.a1) && atomIds.has(b.a2)) bonds.push(b)
  }
  return { id: newId('m'), atoms, bonds }
}

export function fragmentSmiles(frag: Molecule): string | null {
  try {
    const RDKit = getRDKit()
    const mol = RDKit.get_mol(moleculeToMolblock(frag))
    if (!mol) return null
    try {
      return mol.get_smiles()
    } finally {
      mol.delete()
    }
  } catch {
    return null
  }
}

export async function copySelection(): Promise<boolean> {
  const frag = selectedFragment()
  if (!frag) return false
  const smiles = fragmentSmiles(frag)
  if (!smiles) {
    toast('Selection could not be converted to SMILES.', 'error')
    return false
  }
  try {
    await navigator.clipboard.writeText(smiles)
    toast(`Copied SMILES — ${smiles.length > 42 ? smiles.slice(0, 42) + '…' : smiles}`, 'success')
    return true
  } catch {
    toast('Clipboard unavailable in this browser.', 'error')
    return false
  }
}

export async function cutSelection() {
  const { selection } = useEditorStore.getState()
  if (await copySelection()) {
    deleteItems(selection.atomIds, selection.bondIds)
  }
}

/** Duplicate the selection in place, offset down-right, and select the copy. */
export function duplicateSelection() {
  const frag = selectedFragment()
  if (!frag) return
  const copy = cloneMolecule(frag, { x: 40, y: 40 })
  placeMolecule(copy, 0) // no snap-merge: a duplicate should land as its own structure
  useEditorStore.getState().select({
    atomIds: copy.atoms.map((a) => a.id),
    bondIds: copy.bonds.map((b) => b.id),
  })
}
