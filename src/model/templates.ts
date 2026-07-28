import { implicitHsForMolblock, molblockFromSmiles } from '../chem/properties'
import { BOND_LENGTH, moleculeFromMolblock, newId } from './graph'
import type { Atom, Bond, Molecule } from './types'

export interface RingTemplate {
  id: string
  name: string
  /** Plain carbocycle: built as a regular polygon. */
  size?: number
  aromatic?: boolean
  /** Heterocycles / fused systems: built from SMILES via RDKit. */
  smiles?: string
}

export const RING_TEMPLATES: RingTemplate[] = [
  { id: 'benzene', name: 'Benzene', size: 6, aromatic: true },
  { id: 'cyclohexane', name: 'Cyclohexane', size: 6 },
  { id: 'cyclopentane', name: 'Cyclopentane', size: 5 },
  { id: 'cyclopentadiene', name: 'Cyclopentadiene', smiles: 'C1=CC=CC1' },
  { id: 'cyclopropane', name: 'Cyclopropane', size: 3 },
  { id: 'cyclobutane', name: 'Cyclobutane', size: 4 },
  { id: 'cycloheptane', name: 'Cycloheptane', size: 7 },
  { id: 'naphthalene', name: 'Naphthalene', smiles: 'c1ccc2ccccc2c1' },
  { id: 'anthracene', name: 'Anthracene', smiles: 'c1ccc2cc3ccccc3cc2c1' },
  { id: 'pyridine', name: 'Pyridine', smiles: 'c1ccncc1' },
  { id: 'pyrimidine', name: 'Pyrimidine', smiles: 'c1cncnc1' },
  { id: 'imidazole', name: 'Imidazole', smiles: 'c1c[nH]cn1' },
  { id: 'furan', name: 'Furan', smiles: 'c1ccoc1' },
  { id: 'thiophene', name: 'Thiophene', smiles: 'c1ccsc1' },
  { id: 'indole', name: 'Indole', smiles: 'c1ccc2[nH]ccc2c1' },
  { id: 'purine', name: 'Purine', smiles: 'c1ncc2[nH]cnc2n1' },
]

export function ringTemplate(id: string): RingTemplate {
  return RING_TEMPLATES.find((t) => t.id === id) ?? RING_TEMPLATES[0]
}

/** Build a regular n-gon carbocycle centered at origin, one edge horizontal at the bottom. */
function polygonRing(size: number, aromatic: boolean): Molecule {
  const R = BOND_LENGTH / (2 * Math.sin(Math.PI / size))
  const atoms: Atom[] = []
  for (let i = 0; i < size; i++) {
    // Rotate so the bottom edge is horizontal (vertex between the two bottom points)
    const a = (2 * Math.PI * i) / size + Math.PI / 2 + Math.PI / size
    atoms.push({ id: newId('a'), element: 'C', x: Math.cos(a) * R, y: Math.sin(a) * R, charge: 0 })
  }
  const bonds: Bond[] = []
  for (let i = 0; i < size; i++) {
    bonds.push({
      id: newId('b'),
      a1: atoms[i].id,
      a2: atoms[(i + 1) % size].id,
      // Kekulé alternation for benzene-like rings
      order: aromatic && size % 2 === 0 && i % 2 === 0 ? 2 : 1,
      stereo: 'none',
    })
  }
  return { id: newId('m'), atoms, bonds }
}

const templateCache = new Map<string, Molecule>()

/** Instantiate a template centered at the origin. Clone before inserting. */
export function buildRingTemplate(id: string): Molecule | null {
  const cached = templateCache.get(id)
  if (cached) return cloneMolecule(cached)
  const t = ringTemplate(id)
  let mol: Molecule | null = null
  if (t.size) {
    mol = polygonRing(t.size, !!t.aromatic)
  } else if (t.smiles) {
    const mb = molblockFromSmiles(t.smiles)
    if (mb) mol = moleculeFromMolblock(mb, { x: 0, y: 0 }, implicitHsForMolblock(mb))
  }
  if (!mol) return null
  templateCache.set(id, mol)
  return cloneMolecule(mol)
}

/** Deep-clone a molecule with fresh ids (template instantiation). */
export function cloneMolecule(mol: Molecule, offset: { x: number; y: number } = { x: 0, y: 0 }): Molecule {
  const idMap = new Map<string, string>()
  const atoms = mol.atoms.map((a) => {
    const id = newId('a')
    idMap.set(a.id, id)
    return { ...a, id, x: a.x + offset.x, y: a.y + offset.y }
  })
  const bonds = mol.bonds.map((b) => ({
    ...b,
    id: newId('b'),
    a1: idMap.get(b.a1)!,
    a2: idMap.get(b.a2)!,
  }))
  return { id: newId('m'), atoms, bonds }
}
