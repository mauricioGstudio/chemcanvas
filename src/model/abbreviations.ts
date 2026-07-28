/**
 * Superatom abbreviations (§7.8). `smiles` is the expanded fragment written so
 * that the FIRST atom is the attachment point (it bonds to the abbreviated
 * atom's neighbor on expansion).
 */
export interface Abbreviation {
  label: string
  smiles: string
}

export const ABBREVIATIONS: Abbreviation[] = [
  { label: 'Me', smiles: 'C' },
  { label: 'Et', smiles: 'CC' },
  { label: 'Pr', smiles: 'CCC' },
  { label: 'iPr', smiles: 'C(C)C' },
  { label: 'Bu', smiles: 'CCCC' },
  { label: 'tBu', smiles: 'C(C)(C)C' },
  { label: 'Ph', smiles: 'c1ccccc1' },
  { label: 'Bn', smiles: 'Cc1ccccc1' },
  { label: 'Boc', smiles: 'C(=O)OC(C)(C)C' },
  { label: 'Cbz', smiles: 'C(=O)OCc1ccccc1' },
  { label: 'Fmoc', smiles: 'C(=O)OCC1c2ccccc2-c2ccccc21' },
  { label: 'Ac', smiles: 'C(C)=O' },
  { label: 'Tf', smiles: 'S(=O)(=O)C(F)(F)F' },
  { label: 'Ts', smiles: 'S(=O)(=O)c1ccc(C)cc1' },
  { label: 'Ms', smiles: 'S(C)(=O)=O' },
  { label: 'OMs', smiles: 'OS(C)(=O)=O' },
  { label: 'OTf', smiles: 'OS(=O)(=O)C(F)(F)F' },
  { label: 'NHBoc', smiles: 'NC(=O)OC(C)(C)C' },
]

export function abbreviationByLabel(label: string): Abbreviation | undefined {
  return ABBREVIATIONS.find((a) => a.label === label)
}
