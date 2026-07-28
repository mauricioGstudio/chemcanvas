import { moleculeFromMolblock, moleculeToMolblock } from '../model/graph'
import { implicitHsForMolblock, propertiesFromMolblock } from './properties'
import { getRDKit } from './rdkit'

/**
 * Phase-3 round-trip proof, run in dev after RDKit init:
 * RDKit benzene → molblock → internal graph → molblock → RDKit → C6H6.
 */
export function runChemSelfTest(): boolean {
  try {
    const RDKit = getRDKit()
    const mol = RDKit.get_mol('c1ccccc1')
    if (!mol) throw new Error('could not build benzene')
    mol.set_new_coords(true)
    const mb = mol.get_molblock()
    mol.delete()

    const graph = moleculeFromMolblock(mb, { x: 0, y: 0 }, implicitHsForMolblock(mb))
    if (graph.atoms.length !== 6 || graph.bonds.length !== 6) {
      throw new Error(`expected 6 atoms / 6 bonds, got ${graph.atoms.length}/${graph.bonds.length}`)
    }

    const mb2 = moleculeToMolblock(graph)
    const props = propertiesFromMolblock(mb2)
    const pass =
      props.formulaText === 'C₆H₆' &&
      Math.abs(props.mw - 78.114) < 0.01 &&
      props.inchiKey === 'UHOVQNZJYSORNB-UHFFFAOYSA-N'

    console.log(
      `[ChemCanvas selftest] ${pass ? 'PASS' : 'FAIL'} — formula ${props.formulaText}, MW ${props.mw.toFixed(3)}, SMILES ${props.smiles}, InChIKey ${props.inchiKey}`,
    )
    return pass
  } catch (err) {
    console.error('[ChemCanvas selftest] FAIL —', err)
    return false
  }
}
