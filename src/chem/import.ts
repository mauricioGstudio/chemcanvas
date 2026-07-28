import { implicitHsForMolblock } from './properties'
import { getRDKit } from './rdkit'
import { moleculeFromMolblock } from '../model/graph'
import { useDocStore } from '../state/doc'
import { ensureVisible } from '../state/actions'
import { toast } from '../ui/Toasts'

/**
 * File import (§7.9). Everything routes through RDKit: molblocks (V2000 &
 * V3000), SDF records, SMILES lines, InChI (when the build supports it).
 * CDX/CDXML is genuinely out of reach client-side — fails gracefully.
 */

function placeMolblockAt(mb: string, index: number): boolean {
  try {
    const RDKit = getRDKit()
    const mol = RDKit.get_mol(mb)
    if (!mol) return false
    let clean: string
    try {
      if (!mol.has_coords()) mol.set_new_coords(true)
      clean = mol.get_molblock()
    } finally {
      mol.delete()
    }
    const at = { x: index * 260, y: 0 }
    useDocStore
      .getState()
      .addMolecule(moleculeFromMolblock(clean, at, implicitHsForMolblock(clean)))
    return true
  } catch {
    return false
  }
}

function placeSmilesAt(smiles: string, index: number): boolean {
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(smiles.trim())
  if (!mol) return false
  try {
    if (!mol.has_coords()) mol.set_new_coords(true)
    const mb = mol.get_molblock()
    const at = { x: index * 260, y: 0 }
    useDocStore.getState().addMolecule(moleculeFromMolblock(mb, at, implicitHsForMolblock(mb)))
    return true
  } finally {
    mol.delete()
  }
}

export async function importFiles(files: FileList | File[]) {
  let placed = 0
  let failed = 0
  for (const file of Array.from(files)) {
    const name = file.name.toLowerCase()
    const text = await file.text().catch(() => null)
    if (text === null) {
      failed++
      continue
    }

    if (name.endsWith('.cdx') || name.endsWith('.cdxml')) {
      toast(`${file.name}: ChemDraw CDX import isn't supported — export it as .mol or SMILES instead.`, 'error')
      continue
    }

    if (name.endsWith('.sdf') || name.endsWith('.mol') || name.endsWith('.rxn')) {
      // RXN: extract embedded molblocks best-effort by splitting on $MOL
      const records = name.endsWith('.rxn')
        ? text.split('$MOL').slice(1)
        : text.split(/\$\$\$\$\r?\n?/)
      for (const rec of records) {
        const mb = rec.trim()
        if (!mb) continue
        if (placeMolblockAt(mb.startsWith('\n') ? mb : `\n${mb}`, placed)) placed++
        else failed++
      }
      continue
    }

    if (name.endsWith('.smi') || name.endsWith('.smiles')) {
      for (const line of text.split(/\r?\n/)) {
        const smiles = line.trim().split(/\s+/)[0]
        if (!smiles) continue
        if (placeSmilesAt(smiles, placed)) placed++
        else failed++
      }
      continue
    }

    if (name.endsWith('.inchi') || text.trimStart().startsWith('InChI=')) {
      for (const line of text.split(/\r?\n/)) {
        const inchi = line.trim()
        if (!inchi.startsWith('InChI=')) continue
        // The minimal RDKit build may not parse InChI; try and fail gracefully.
        if (placeSmilesAt(inchi, placed)) placed++
        else {
          failed++
          toast('This RDKit build cannot read InChI — paste a SMILES instead.', 'error')
        }
      }
      continue
    }

    // Unknown extension: try molblock, then SMILES-per-line
    if (placeMolblockAt(text, placed)) {
      placed++
    } else if (placeSmilesAt(text.trim(), placed)) {
      placed++
    } else {
      failed++
      toast(`${file.name}: couldn't recognize this file's format.`, 'error')
    }
  }

  if (placed > 0) {
    ensureVisible()
    toast(`Imported ${placed} structure${placed > 1 ? 's' : ''}.`, 'success')
  } else if (failed > 0) {
    toast('Nothing could be imported from those files.', 'error')
  }
}
