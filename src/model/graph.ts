import type { Box } from '../canvas/view'
import { parseMolblock, serializeMolblock } from '../chem/molblock'
import type { Atom, Bond, Molecule } from './types'

/** Standard bond length in world px (at 100% zoom). */
export const BOND_LENGTH = 60
/** Molblock unit bond length we serialize to (RDKit's classic standard). */
const MOLBLOCK_BOND = 1.5

export function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build an internal Molecule from a V2000 molblock:
 * scale so the median bond length is BOND_LENGTH, flip Y (molblock Y is up),
 * and center the structure on `at` (defaults to world origin).
 *
 * `implicitHs` (RDKit-perceived, by atom index) may be attached by the caller.
 */
export function moleculeFromMolblock(
  mb: string,
  at: { x: number; y: number } = { x: 0, y: 0 },
  implicitHs?: number[],
): Molecule {
  const raw = parseMolblock(mb)

  const lengths = raw.bonds
    .map((b) => {
      const a = raw.atoms[b.a1]
      const c = raw.atoms[b.a2]
      return Math.hypot(a.x - c.x, a.y - c.y)
    })
    .filter((l) => l > 1e-6)
    .sort((x, y) => x - y)
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0
  const scale = median > 0 ? BOND_LENGTH / median : BOND_LENGTH / MOLBLOCK_BOND

  const xs = raw.atoms.map((a) => a.x)
  const ys = raw.atoms.map((a) => a.y)
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0

  const atoms: Atom[] = raw.atoms.map((a, i) => ({
    id: newId('a'),
    element: a.element,
    x: (a.x - cx) * scale + at.x,
    y: -(a.y - cy) * scale + at.y,
    charge: a.charge,
    isotope: a.isotope,
    radical: a.radical,
    mapNum: a.mapNum,
    implicitH: implicitHs?.[i],
  }))

  const bonds: Bond[] = raw.bonds.map((b) => ({
    id: newId('b'),
    a1: atoms[b.a1].id,
    a2: atoms[b.a2].id,
    order: b.order,
    stereo: b.stereo,
  }))

  return { id: newId('m'), atoms, bonds }
}

/** Serialize an internal Molecule to a V2000 molblock (canvas → molblock coords). */
export function moleculeToMolblock(mol: Molecule): string {
  if (mol.atoms.length === 0) throw new Error('Cannot serialize an empty molecule')
  const xs = mol.atoms.map((a) => a.x)
  const ys = mol.atoms.map((a) => a.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const k = MOLBLOCK_BOND / BOND_LENGTH
  return serializeMolblock(mol, (p) => ({ x: (p.x - cx) * k, y: -(p.y - cy) * k }))
}

export function moleculeBounds(mol: Molecule): Box | null {
  if (mol.atoms.length === 0) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const a of mol.atoms) {
    if (a.x < minX) minX = a.x
    if (a.y < minY) minY = a.y
    if (a.x > maxX) maxX = a.x
    if (a.y > maxY) maxY = a.y
  }
  return { minX, minY, maxX, maxY }
}

export function docBounds(mols: Molecule[]): Box | null {
  let box: Box | null = null
  for (const m of mols) {
    const b = moleculeBounds(m)
    if (!b) continue
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b
  }
  return box
}

export function atomById(mol: Molecule, id: string): Atom | undefined {
  return mol.atoms.find((a) => a.id === id)
}

/** Neighbors of an atom (atom ids) within its molecule. */
export function neighborsOf(mol: Molecule, atomId: string): string[] {
  const out: string[] = []
  for (const b of mol.bonds) {
    if (b.a1 === atomId) out.push(b.a2)
    else if (b.a2 === atomId) out.push(b.a1)
  }
  return out
}
