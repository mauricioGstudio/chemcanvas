import type { BondOrder, BondStereo, Molecule } from '../model/types'

/**
 * MDL V2000 molblock ⇄ internal graph.
 *
 * This module deals only with the V2000 text format. Anything exotic (V3000,
 * aromatic perception, implicit H) is routed through RDKit first — see
 * model/graph.ts and chem/properties.ts. Coordinates here are RAW molblock
 * coordinates (Y up); scaling/flipping to canvas space happens in graph.ts.
 */

export interface RawAtom {
  element: string
  x: number
  y: number
  charge: number
  isotope?: number
  radical?: 0 | 1 | 2
  mapNum?: number
}

export interface RawBond {
  a1: number // 0-based atom index
  a2: number
  order: BondOrder
  stereo: BondStereo
}

export interface RawMol {
  atoms: RawAtom[]
  bonds: RawBond[]
}

const BOND_ORDER_FROM_MDL: Record<number, BondOrder> = { 1: 1, 2: 2, 3: 3, 4: 'aromatic' }
const MDL_FROM_BOND_ORDER: Record<string, number> = { '1': 1, '2': 2, '3': 3, aromatic: 4 }
const STEREO_FROM_MDL: Record<number, BondStereo> = { 0: 'none', 1: 'wedge', 4: 'wavy', 6: 'dash' }
const MDL_FROM_STEREO: Record<BondStereo, number> = { none: 0, wedge: 1, wavy: 4, dash: 6 }

/** Legacy atom-block charge column (superseded by M CHG when present). */
const LEGACY_CHARGE: Record<number, number> = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 }

export function parseMolblock(mb: string): RawMol {
  const lines = mb.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < 4) throw new Error('Molblock too short')
  const counts = lines[3]
  if (counts.includes('V3000')) {
    throw new Error('V3000 molblocks must be converted through RDKit first')
  }
  const nAtoms = parseInt(counts.slice(0, 3), 10)
  const nBonds = parseInt(counts.slice(3, 6), 10)
  if (!Number.isFinite(nAtoms) || !Number.isFinite(nBonds)) {
    throw new Error('Invalid molblock counts line')
  }

  const atoms: RawAtom[] = []
  for (let i = 0; i < nAtoms; i++) {
    const line = lines[4 + i] ?? ''
    const x = parseFloat(line.slice(0, 10))
    const y = parseFloat(line.slice(10, 20))
    const element = line.slice(31, 34).trim() || 'C'
    const legacyChg = parseInt(line.slice(36, 39), 10) || 0
    atoms.push({
      element,
      x,
      y,
      charge: LEGACY_CHARGE[legacyChg] ?? 0,
      mapNum: parseInt(line.slice(60, 63), 10) || undefined,
    })
  }

  const bonds: RawBond[] = []
  for (let i = 0; i < nBonds; i++) {
    const line = lines[4 + nAtoms + i] ?? ''
    const a1 = parseInt(line.slice(0, 3), 10) - 1
    const a2 = parseInt(line.slice(3, 6), 10) - 1
    const type = parseInt(line.slice(6, 9), 10)
    const stereo = parseInt(line.slice(9, 12), 10) || 0
    bonds.push({
      a1,
      a2,
      order: BOND_ORDER_FROM_MDL[type] ?? 1,
      stereo: STEREO_FROM_MDL[stereo] ?? 'none',
    })
  }

  // Properties block: M CHG / M ISO / M RAD override the atom block.
  let sawMChg = false
  for (let i = 4 + nAtoms + nBonds; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('M  END')) break
    const tag = line.slice(0, 6)
    if (tag === 'M  CHG' || tag === 'M  ISO' || tag === 'M  RAD') {
      if (tag === 'M  CHG' && !sawMChg) {
        // M CHG supersedes ALL legacy charge columns
        for (const a of atoms) a.charge = 0
        sawMChg = true
      }
      const n = parseInt(line.slice(6, 9), 10)
      for (let k = 0; k < n; k++) {
        const idx = parseInt(line.slice(9 + k * 8, 13 + k * 8), 10) - 1
        const val = parseInt(line.slice(13 + k * 8, 17 + k * 8), 10)
        const atom = atoms[idx]
        if (!atom) continue
        if (tag === 'M  CHG') atom.charge = val
        else if (tag === 'M  ISO') atom.isotope = val
        else if (tag === 'M  RAD') atom.radical = (val === 2 ? 1 : val === 3 ? 2 : 0) as 0 | 1 | 2
      }
    }
  }

  return { atoms, bonds }
}

function fixed(n: number, width: number, decimals: number): string {
  return n.toFixed(decimals).padStart(width)
}

function int3(n: number): string {
  return String(n).padStart(3)
}

/**
 * Serialize an internal Molecule to a V2000 molblock.
 * `toMolCoords` maps canvas coords → molblock coords (scale + Y flip).
 */
export function serializeMolblock(
  mol: Molecule,
  toMolCoords: (a: { x: number; y: number }) => { x: number; y: number },
): string {
  const idx = new Map<string, number>()
  mol.atoms.forEach((a, i) => idx.set(a.id, i))

  const lines: string[] = ['', '  ChemCanvas 2D', '']
  lines.push(
    `${int3(mol.atoms.length)}${int3(mol.bonds.length)}  0  0  0  0  0  0  0  0999 V2000`,
  )

  for (const a of mol.atoms) {
    const p = toMolCoords(a)
    const sym = a.element.padEnd(3)
    const mapNum = a.mapNum ?? 0
    lines.push(
      `${fixed(p.x, 10, 4)}${fixed(p.y, 10, 4)}${fixed(0, 10, 4)} ${sym} 0  0  0  0  0  0  0  0  0${int3(mapNum)}  0  0`,
    )
  }

  for (const b of mol.bonds) {
    const a1 = (idx.get(b.a1) ?? 0) + 1
    const a2 = (idx.get(b.a2) ?? 0) + 1
    lines.push(
      `${int3(a1)}${int3(a2)}${int3(MDL_FROM_BOND_ORDER[String(b.order)])}${int3(MDL_FROM_STEREO[b.stereo ?? 'none'])}`,
    )
  }

  const chg = mol.atoms.map((a, i) => [i + 1, a.charge] as const).filter(([, c]) => c !== 0)
  const iso = mol.atoms.map((a, i) => [i + 1, a.isotope] as const).filter(([, v]) => v)
  const rad = mol.atoms
    .map((a, i) => [i + 1, a.radical] as const)
    .filter(([, r]) => r === 1 || r === 2)
    .map(([i, r]) => [i, r === 1 ? 2 : 3] as const) // MDL: 2 = doublet (monoradical), 3 = triplet

  for (const [name, pairs] of [
    ['CHG', chg],
    ['ISO', iso],
    ['RAD', rad],
  ] as const) {
    for (let i = 0; i < pairs.length; i += 8) {
      const chunk = pairs.slice(i, i + 8)
      if (chunk.length === 0) continue
      // Format: "M  CHGnnn" then per pair " aaa vvv" (each value 4 wide)
      lines.push(
        `M  ${name}${int3(chunk.length)}` +
          chunk.map(([ai, v]) => `${String(ai).padStart(4)}${String(v).padStart(4)}`).join(''),
      )
    }
  }

  lines.push('M  END')
  return lines.join('\n') + '\n'
}
