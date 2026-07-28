import { ELEMENTS } from '../model/elements'
import { moleculeToMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { implicitHsForMolblock } from './properties'
import { isRDKitReady } from './rdkit'

export interface ValenceIssue {
  atomId: string
  message: string
}

/** Sum of explicit bond orders at each atom (aromatic counts as 1.5). */
function bondOrderSums(mol: Molecule): Map<string, number> {
  const sums = new Map<string, number>()
  for (const b of mol.bonds) {
    const o = b.order === 'aromatic' ? 1.5 : b.order
    sums.set(b.a1, (sums.get(b.a1) ?? 0) + o)
    sums.set(b.a2, (sums.get(b.a2) ?? 0) + o)
  }
  return sums
}

/** Charge-adjusted allowed valences (warning heuristic — RDKit stays the chemistry authority). */
function allowedValences(element: string, charge: number): number[] {
  const base = ELEMENTS[element]?.valences ?? []
  if (base.length === 0) return []
  if (charge === 0) return base
  switch (element) {
    case 'N':
    case 'P':
    case 'As':
      return charge === 1 ? [4] : charge === -1 ? [2] : base
    case 'O':
    case 'S':
    case 'Se':
      return charge === 1 ? [3] : charge === -1 ? [1] : base
    case 'C':
    case 'Si':
      return Math.abs(charge) === 1 ? [3] : base
    case 'B':
      return charge === -1 ? [4] : base
    default:
      return base
  }
}

/**
 * Chemistry refresh for one molecule after an edit:
 * - implicit H per atom (RDKit when the structure parses; valence-table fallback otherwise)
 * - over-valence warnings (amber dots, §5.3 — inform, never block)
 */
export function refreshMoleculeChemistry(mol: Molecule): {
  molecule: Molecule
  issues: ValenceIssue[]
} {
  const sums = bondOrderSums(mol)
  const issues: ValenceIssue[] = []

  // Local over-valence check (works even when RDKit refuses to parse)
  for (const a of mol.atoms) {
    const allowed = allowedValences(a.element, a.charge)
    if (allowed.length === 0) continue
    const sum = Math.round((sums.get(a.id) ?? 0) * 2) / 2
    const max = Math.max(...allowed)
    if (sum > max) {
      const chargeNote =
        a.charge !== 0 ? ` for ${a.element}${a.charge > 0 ? '⁺' : '⁻'}` : ` for neutral ${a.element}`
      issues.push({
        atomId: a.id,
        message: `${a.element} has ${sum} bonds; max is ${max}${chargeNote}`,
      })
    }
  }

  let implicitHs: number[] = []
  if (isRDKitReady() && mol.atoms.length > 0) {
    try {
      implicitHs = implicitHsForMolblock(moleculeToMolblock(mol))
    } catch {
      implicitHs = []
    }
  }

  const atoms = mol.atoms.map((a, i) => {
    let h = implicitHs[i]
    if (h === undefined) {
      // Fallback: smallest allowed valence that fits the current bond sum
      const allowed = allowedValences(a.element, a.charge)
      const sum = sums.get(a.id) ?? 0
      const target = allowed.find((v) => v >= sum)
      h = target !== undefined ? Math.max(0, Math.round(target - sum)) : 0
    }
    return a.implicitH === h ? a : { ...a, implicitH: h }
  })

  return { molecule: { ...mol, atoms }, issues }
}
