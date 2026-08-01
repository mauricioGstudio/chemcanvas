/**
 * Accurate 3D geometry from NCI CACTUS.
 *
 * The local generator in `conformer.ts` derives geometry from VSEPR rules —
 * good enough to see a shape, but idealized. NCI's public structure service
 * returns properly embedded 3D coordinates (real chair puckers, real
 * torsions), which is materially better for anything a chemist would
 * actually judge.
 *
 * The trade: the structure has to leave the machine. That is a real cost for
 * unpublished work, so this is a preference the user can switch off, and it
 * always falls back to local generation when disabled, offline, or when the
 * service doesn't know the structure. The privacy policy documents it.
 */

import type { Conformer, Atom3D } from './conformer'

const CACTUS = 'https://cactus.nci.nih.gov/chemical/structure'
const PREF_KEY = 'chemcanvas:precise3d'

export function precise3DEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setPrecise3D(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode — preference just won't persist */
  }
}

/** Parse a V2000 molblock that carries real 3D coordinates. */
function parse3DMolblock(text: string): Conformer | null {
  const lines = text.split(/\r?\n/)
  if (lines.length < 5) return null
  // Counts line is the 4th line: "aaabbb..."
  const counts = lines[3]
  const atomCount = parseInt(counts.slice(0, 3), 10)
  const bondCount = parseInt(counts.slice(3, 6), 10)
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount <= 0) return null

  const atoms: Atom3D[] = []
  for (let i = 0; i < atomCount; i++) {
    const l = lines[4 + i]
    if (!l) return null
    const x = parseFloat(l.slice(0, 10))
    const y = parseFloat(l.slice(10, 20))
    const z = parseFloat(l.slice(20, 30))
    const element = l.slice(31, 34).trim()
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !element) return null
    atoms.push({
      id: `r${i}`,
      element,
      x,
      y,
      z,
      charge: 0,
      // Hydrogens come back explicit from the service; flag them so the
      // "H atoms" toggle still works the same way as locally-built models.
      implicit: element === 'H',
    })
  }

  const bonds: Conformer['bonds'] = []
  for (let i = 0; i < bondCount; i++) {
    const l = lines[4 + atomCount + i]
    if (!l) break
    const a = parseInt(l.slice(0, 3), 10) - 1
    const b = parseInt(l.slice(3, 6), 10) - 1
    const order = parseInt(l.slice(6, 9), 10)
    if (!atoms[a] || !atoms[b]) continue
    bonds.push({
      a1: atoms[a].id,
      a2: atoms[b].id,
      order: order === 2 ? 2 : order === 3 ? 3 : order === 4 ? 'aromatic' : 1,
    })
  }
  if (bonds.length === 0) return null

  // Centre on the origin and measure the bounding radius, matching what the
  // local generator returns so the viewer can treat them identically.
  let cx = 0
  let cy = 0
  let cz = 0
  for (const a of atoms) {
    cx += a.x
    cy += a.y
    cz += a.z
  }
  cx /= atoms.length
  cy /= atoms.length
  cz /= atoms.length
  let radius = 0
  for (const a of atoms) {
    a.x -= cx
    a.y -= cy
    a.z -= cz
    radius = Math.max(radius, Math.hypot(a.x, a.y, a.z))
  }

  return { atoms, bonds, radius: Math.max(radius, 1) }
}

/**
 * Ask CACTUS for an embedded 3D structure. Resolves to null on any failure
 * so the caller can fall back to local generation without special-casing.
 */
export async function fetchConformer3D(
  smiles: string,
  signal?: AbortSignal,
): Promise<Conformer | null> {
  if (!precise3DEnabled()) return null
  try {
    const url = `${CACTUS}/${encodeURIComponent(smiles)}/file?format=sdf&get3d=true`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || /not found/i.test(text.slice(0, 200))) return null
    const conf = parse3DMolblock(text)
    if (!conf) return null
    // A flat result means the service fell back to 2D; the local generator
    // does better than that, so treat it as a miss.
    const spread = conf.atoms.reduce((m, a) => Math.max(m, Math.abs(a.z)), 0)
    if (conf.atoms.length > 4 && spread < 1e-3) return null
    return conf
  } catch {
    return null
  }
}
