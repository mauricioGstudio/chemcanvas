import { symbolForZ } from '../model/elements'
import { getRDKit } from './rdkit'

/**
 * All chemistry values come from RDKit — nothing here re-derives chemistry.
 * The one piece of assembly we do ourselves is counting RDKit's own atoms
 * (element + RDKit-perceived implicit H) into a Hill-order formula string,
 * because RDKit.js does not expose the formula directly.
 */

export interface MolProperties {
  formula: FormulaPart[]
  formulaText: string
  mw: number
  exactMass: number
  smiles: string
  inchi: string
  inchiKey: string
  atomCount: number
  heavyAtomCount: number
  ringCount: number
  charge: number
  /** Degree of unsaturation, computed from RDKit's own descriptor set. */
  unsaturation: number
  /** element → count, for the composition table. */
  composition: Record<string, number>
}

export interface FormulaPart {
  text: string
  sub?: boolean
  sup?: boolean
}

interface CCAtom {
  z?: number
  impHs?: number
  chg?: number
}

/** Count element occurrences (incl. RDKit-perceived implicit H) from commonchem JSON. */
function countsFromMolJson(json: string): { counts: Record<string, number>; charge: number } {
  const doc = JSON.parse(json) as {
    defaults?: { atom?: CCAtom }
    molecules?: { atoms?: CCAtom[] }[]
  }
  const dz = doc.defaults?.atom?.z ?? 6
  const dh = doc.defaults?.atom?.impHs ?? 0
  const dc = doc.defaults?.atom?.chg ?? 0
  const counts: Record<string, number> = {}
  let charge = 0
  for (const m of doc.molecules ?? []) {
    for (const a of m.atoms ?? []) {
      const sym = symbolForZ(a.z ?? dz)
      counts[sym] = (counts[sym] ?? 0) + 1
      const h = a.impHs ?? dh
      if (h > 0) counts.H = (counts.H ?? 0) + h
      charge += a.chg ?? dc
    }
  }
  return { counts, charge }
}

/** Hill order: C, H, then alphabetical (alphabetical if no carbon). */
function hillOrder(counts: Record<string, number>): [string, number][] {
  const keys = Object.keys(counts)
  const hasC = keys.includes('C')
  return keys
    .sort((a, b) => {
      if (hasC) {
        if (a === 'C') return -1
        if (b === 'C') return 1
        if (a === 'H') return -1
        if (b === 'H') return 1
      }
      return a.localeCompare(b)
    })
    .map((k) => [k, counts[k]])
}

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'

export function formulaToParts(counts: Record<string, number>, charge: number): FormulaPart[] {
  const parts: FormulaPart[] = []
  for (const [el, n] of hillOrder(counts)) {
    parts.push({ text: el })
    if (n > 1) parts.push({ text: String(n), sub: true })
  }
  if (charge !== 0) {
    const mag = Math.abs(charge)
    parts.push({ text: `${mag > 1 ? mag : ''}${charge > 0 ? '+' : '−'}`, sup: true })
  }
  return parts
}

export function formulaPartsToText(parts: FormulaPart[]): string {
  return parts
    .map((p) => (p.sub ? [...p.text].map((d) => SUB_DIGITS[+d] ?? d).join('') : p.text))
    .join('')
}

/**
 * Compute properties for a structure given as a V2000 molblock.
 * Throws if RDKit cannot parse the molblock.
 */
export function propertiesFromMolblock(molblock: string): MolProperties {
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(molblock)
  if (!mol) throw new Error('RDKit could not parse the structure')
  try {
    const desc = JSON.parse(mol.get_descriptors()) as Record<string, number>
    const { counts, charge } = countsFromMolJson(mol.get_json())
    const formula = formulaToParts(counts, charge)
    let inchi = ''
    let inchiKey = ''
    try {
      inchi = mol.get_inchi()
      inchiKey = inchi ? RDKit.get_inchikey_for_inchi(inchi) : ''
    } catch {
      /* InChI can fail on exotic structures; leave blank rather than crash */
    }
    const heavy = desc.NumHeavyAtoms ?? 0
    const nH = counts.H ?? 0
    // DBE from RDKit-perceived composition: C - (H+X)/2 + N/2 + 1
    const halogens = (counts.F ?? 0) + (counts.Cl ?? 0) + (counts.Br ?? 0) + (counts.I ?? 0)
    const unsaturation = (counts.C ?? 0) - (nH + halogens) / 2 + (counts.N ?? 0) / 2 + 1

    return {
      formula,
      formulaText: formulaPartsToText(formula),
      mw: desc.amw ?? 0,
      exactMass: desc.exactmw ?? 0,
      smiles: mol.get_smiles(),
      inchi,
      inchiKey,
      atomCount: heavy + nH,
      heavyAtomCount: heavy,
      ringCount: desc.NumRings ?? 0,
      charge,
      unsaturation,
      composition: counts,
    }
  } finally {
    mol.delete()
  }
}

/** RDKit-perceived implicit H count per atom index, for a molblock. */
export function implicitHsForMolblock(molblock: string): number[] {
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(molblock)
  if (!mol) return []
  try {
    const doc = JSON.parse(mol.get_json()) as {
      defaults?: { atom?: CCAtom }
      molecules?: { atoms?: CCAtom[] }[]
    }
    const dh = doc.defaults?.atom?.impHs ?? 0
    return (doc.molecules?.[0]?.atoms ?? []).map((a) => a.impHs ?? dh)
  } finally {
    mol.delete()
  }
}

/**
 * CIP stereo labels for a molblock, keyed by atom/bond index (RDKit CIP engine).
 * Atom entries like "R"/"S"; bond entries like "E"/"Z".
 */
export function stereoTagsForMolblock(molblock: string): {
  atoms: Map<number, string>
  bonds: Map<number, string>
} {
  const out = { atoms: new Map<number, string>(), bonds: new Map<number, string>() }
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(molblock)
  if (!mol) return out
  try {
    const tags = JSON.parse(mol.get_stereo_tags()) as {
      CIP_atoms?: [number, string][]
      CIP_bonds?: [number, number, string][] | [number, string][]
    }
    for (const [idx, tag] of tags.CIP_atoms ?? []) {
      out.atoms.set(idx, String(tag).replace(/[()?]/g, ''))
    }
    for (const entry of tags.CIP_bonds ?? []) {
      // Entries are [beginAtom, endAtom, label] in current RDKit.js
      if (entry.length === 3) {
        const [a1, a2, tag] = entry as [number, number, string]
        out.bonds.set(a1 * 100000 + a2, String(tag).replace(/[()?]/g, ''))
        out.bonds.set(a2 * 100000 + a1, String(tag).replace(/[()?]/g, ''))
      } else {
        const [idx, tag] = entry as unknown as [number, string]
        out.bonds.set(idx, String(tag).replace(/[()?]/g, ''))
      }
    }
    return out
  } catch {
    return out
  } finally {
    mol.delete()
  }
}

/** SMILES → V2000 molblock with 2D coords (CoordGen), or null if invalid. */
export function molblockFromSmiles(smiles: string): string | null {
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(smiles)
  if (!mol) return null
  try {
    // CoordGen output is already clean and uniform; normalize_depiction can
    // shear it (verified live), so we deliberately don't call it.
    if (!mol.has_coords()) mol.set_new_coords(true)
    return mol.get_molblock()
  } finally {
    mol.delete()
  }
}

/** Quick validity check + formula preview for live input validation. */
export function validateSmiles(smiles: string): { valid: boolean; formulaText?: string } {
  const RDKit = getRDKit()
  const mol = RDKit.get_mol(smiles)
  if (!mol) return { valid: false }
  try {
    const { counts, charge } = countsFromMolJson(mol.get_json())
    return { valid: true, formulaText: formulaPartsToText(formulaToParts(counts, charge)) }
  } finally {
    mol.delete()
  }
}
