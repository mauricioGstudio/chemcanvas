import { screenToWorld, type Box } from '../canvas/view'
import { implicitHsForMolblock, molblockFromSmiles, propertiesFromMolblock } from '../chem/properties'
import { docBounds, moleculeBounds, moleculeFromMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { toast } from '../ui/Toasts'
import { useDocStore } from './doc'
import { useEditorStore } from './editor'

/**
 * Cross-store actions: operations that touch document + editor state together.
 */

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/** Ensure the whole document is visible; zoom-to-fit if anything lies outside. */
export function ensureVisible() {
  const { view, viewport, fitView } = useEditorStore.getState()
  const bounds = docBounds(useDocStore.getState().molecules)
  if (!bounds) return
  const vp: Box = {
    minX: -view.x / view.zoom,
    minY: -view.y / view.zoom,
    maxX: (viewport.w - view.x) / view.zoom,
    maxY: (viewport.h - view.y) / view.zoom,
  }
  const inside =
    bounds.minX >= vp.minX && bounds.maxX <= vp.maxX && bounds.minY >= vp.minY && bounds.maxY <= vp.maxY
  if (!inside) fitView(bounds)
}

/**
 * Place a structure from SMILES onto the canvas as an editable molecule.
 * Placement: viewport center, nudged right of existing content on overlap.
 * Returns the placed molecule, or null when SMILES is invalid.
 */
export function placeStructureFromSmiles(
  smiles: string,
  displayName?: string,
  opts: { silent?: boolean } = {},
): Molecule | null {
  const mb = molblockFromSmiles(smiles)
  if (!mb) return null

  const editor = useEditorStore.getState()
  const at = screenToWorld(editor.view, editor.viewport.w / 2, editor.viewport.h / 2)
  let mol = moleculeFromMolblock(mb, at, implicitHsForMolblock(mb))

  // Nudge right if the drop spot overlaps existing structures
  const existing = docBounds(useDocStore.getState().molecules)
  let bounds = moleculeBounds(mol)
  if (existing && bounds && boxesOverlap(existing, bounds)) {
    const dx = existing.maxX + (bounds.maxX - bounds.minX) / 2 + 60 - at.x
    mol = { ...mol, atoms: mol.atoms.map((a) => ({ ...a, x: a.x + dx })) }
    bounds = moleculeBounds(mol)
  }

  useDocStore.getState().addMolecule(mol)
  ensureVisible()

  if (!opts.silent) {
    try {
      const props = propertiesFromMolblock(mb)
      toast(
        `Placed ${displayName ?? props.formulaText} — ${props.formulaText} — ${props.mw.toFixed(2)} g/mol`,
        'success',
      )
    } catch {
      toast(`Placed ${displayName ?? 'structure'}`, 'success')
    }
  }
  return mol
}
