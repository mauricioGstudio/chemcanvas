/**
 * The left-sidebar template library. Each entry is a SMILES string
 * instantiated through the same RDKit → molblock → graph path as a lookup
 * result, so every template lands as a fully editable structure.
 */
export interface LibraryItem {
  name: string
  smiles: string
}

export interface LibraryGroup {
  id: string
  title: string
  items: LibraryItem[]
}

export const TEMPLATE_LIBRARY: LibraryGroup[] = [
  {
    id: 'rings',
    title: 'Common Rings',
    items: [
      { name: 'Benzene', smiles: 'c1ccccc1' },
      { name: 'Cyclohexane', smiles: 'C1CCCCC1' },
      { name: 'Cyclopentane', smiles: 'C1CCCC1' },
      { name: 'Cyclopropane', smiles: 'C1CC1' },
      { name: 'Cyclobutane', smiles: 'C1CCC1' },
      { name: 'Cyclopentadiene', smiles: 'C1=CCC=C1' },
      { name: 'Naphthalene', smiles: 'c1ccc2ccccc2c1' },
      { name: 'Anthracene', smiles: 'c1ccc2cc3ccccc3cc2c1' },
      { name: 'Pyridine', smiles: 'c1ccncc1' },
      { name: 'Pyrimidine', smiles: 'c1cncnc1' },
      { name: 'Imidazole', smiles: 'c1c[nH]cn1' },
      { name: 'Furan', smiles: 'c1ccoc1' },
      { name: 'Thiophene', smiles: 'c1ccsc1' },
      { name: 'Indole', smiles: 'c1ccc2[nH]ccc2c1' },
      { name: 'Purine', smiles: 'c1nc2[nH]cnc2n1' },
      { name: 'Decalin (fused)', smiles: 'C1CCC2CCCCC2C1' },
      { name: 'Spiro[4.4]nonane', smiles: 'C1CCC2(C1)CCCC2' },
    ],
  },
  {
    id: 'functional',
    title: 'Functional Groups',
    items: [
      { name: 'Hydroxyl', smiles: 'CO' },
      { name: 'Amine', smiles: 'CN' },
      { name: 'Carboxylic acid', smiles: 'CC(=O)O' },
      { name: 'Ester', smiles: 'CC(=O)OC' },
      { name: 'Amide', smiles: 'CC(=O)N' },
      { name: 'Aldehyde', smiles: 'CC=O' },
      { name: 'Ketone', smiles: 'CC(=O)C' },
      { name: 'Nitro', smiles: 'C[N+](=O)[O-]' },
      { name: 'Sulfonyl', smiles: 'CS(=O)(=O)C' },
      { name: 'Phosphate', smiles: 'OP(=O)(O)O' },
      { name: 'Thiol', smiles: 'CS' },
      { name: 'Ether', smiles: 'COC' },
      { name: 'Epoxide', smiles: 'C1CO1' },
      { name: 'Alkene', smiles: 'C=C' },
      { name: 'Alkyne', smiles: 'C#C' },
      { name: 'Anhydride', smiles: 'CC(=O)OC(=O)C' },
      { name: 'Lactam (γ)', smiles: 'O=C1CCCN1' },
      { name: 'Lactone (γ)', smiles: 'O=C1CCCO1' },
      { name: 'Urea', smiles: 'NC(=O)N' },
      { name: 'Carbamate', smiles: 'COC(=O)N' },
      { name: 'Nitrile', smiles: 'CC#N' },
    ],
  },
  {
    id: 'amino',
    title: 'Amino Acids',
    items: [
      { name: 'Glycine', smiles: 'C(C(=O)[O-])[NH3+]' },
      { name: 'Alanine', smiles: 'C[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Valine', smiles: 'CC(C)[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Leucine', smiles: 'CC(C)C[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Isoleucine', smiles: 'CC[C@H](C)[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Proline', smiles: 'C1CC[NH2+][C@@H]1C(=O)[O-]' },
      { name: 'Phenylalanine', smiles: 'c1ccc(C[C@@H](C(=O)[O-])[NH3+])cc1' },
      { name: 'Tryptophan', smiles: 'c1ccc2c(c1)c(C[C@@H](C(=O)[O-])[NH3+])c[nH]2' },
      { name: 'Serine', smiles: 'OC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Threonine', smiles: 'C[C@@H](O)[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Cysteine', smiles: 'SC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Methionine', smiles: 'CSCC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Asparagine', smiles: 'NC(=O)C[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Glutamine', smiles: 'NC(=O)CC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Tyrosine', smiles: 'Oc1ccc(C[C@@H](C(=O)[O-])[NH3+])cc1' },
      { name: 'Aspartate', smiles: '[O-]C(=O)C[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Glutamate', smiles: '[O-]C(=O)CC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Lysine', smiles: '[NH3+]CCCC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Arginine', smiles: 'NC(=[NH2+])NCCC[C@@H](C(=O)[O-])[NH3+]' },
      { name: 'Histidine', smiles: 'c1c([nH]cn1)C[C@@H](C(=O)[O-])[NH3+]' },
    ],
  },
  {
    id: 'nucleotides',
    title: 'Nucleotides & Bases',
    items: [
      { name: 'Adenine', smiles: 'c1nc(c2c(n1)n(cn2)[H])N' },
      { name: 'Guanine', smiles: 'c1[nH]c2c(n1)c(=O)[nH]c(n2)N' },
      { name: 'Cytosine', smiles: 'C1=C(NC(=O)N=C1)N' },
      { name: 'Thymine', smiles: 'CC1=CNC(=O)NC1=O' },
      { name: 'Uracil', smiles: 'C1=CNC(=O)NC1=O' },
      { name: 'Ribose', smiles: 'C1[C@@H]([C@H]([C@@H](O1)O)O)O' },
      { name: 'Deoxyribose', smiles: 'C1[C@@H]([C@H](O[C@@H]1O)CO)O' },
      { name: 'ATP', smiles: 'c1nc(c2c(n1)n(cn2)[C@H]3[C@@H]([C@@H]([C@H](O3)COP(=O)(O)OP(=O)(O)OP(=O)(O)O)O)O)N' },
      { name: 'ADP', smiles: 'c1nc(c2c(n1)n(cn2)[C@H]3[C@@H]([C@@H]([C@H](O3)COP(=O)(O)OP(=O)(O)O)O)O)N' },
      { name: 'NAD+', smiles: 'c1cc[n+](cc1C(=O)N)[C@H]2[C@@H]([C@@H]([C@H](O2)COP(=O)([O-])OP(=O)(O)OC[C@@H]3[C@H]([C@H]([C@@H](O3)n4cnc5c4ncnc5N)O)O)O)O' },
    ],
  },
  {
    id: 'scaffolds',
    title: 'Drug Scaffolds',
    items: [
      { name: 'β-Lactam', smiles: 'O=C1CCN1' },
      { name: 'Dihydropyridine', smiles: 'C1C=CNC=C1' },
      { name: 'Benzodiazepine', smiles: 'C1CN=C(c2cccc2N1)c1ccccc1' },
      { name: 'Thiazolidine', smiles: 'C1CSCN1' },
      { name: 'Morpholine', smiles: 'C1COCCN1' },
      { name: 'Piperazine', smiles: 'C1CNCCN1' },
      { name: 'Piperidine', smiles: 'C1CCNCC1' },
      { name: 'Quinoline', smiles: 'c1ccc2ncccc2c1' },
      { name: 'Isoquinoline', smiles: 'c1ccc2cnccc2c1' },
      { name: 'Indazole', smiles: 'c1ccc2[nH]ncc2c1' },
      { name: 'Coumarin', smiles: 'O=c1ccc2ccccc2o1' },
    ],
  },
]

// ---- Custom templates (localStorage) ----

const CUSTOM_KEY = 'chemcanvas:templates'

export interface CustomTemplate {
  id: string
  name: string
  smiles: string
}

export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (raw) return JSON.parse(raw) as CustomTemplate[]
  } catch {
    /* ignore */
  }
  return []
}

export function saveCustomTemplate(name: string, smiles: string): CustomTemplate {
  const list = loadCustomTemplates()
  const tpl: CustomTemplate = { id: `t${Date.now()}`, name, smiles }
  list.push(tpl)
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  return tpl
}

export function deleteCustomTemplate(id: string) {
  const list = loadCustomTemplates().filter((t) => t.id !== id)
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
}
