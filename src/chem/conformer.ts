/**
 * 3D coordinate generation for the AR viewer.
 *
 * Honest scope: RDKit's MinimalLib build ships no 3D embedding (no ETKDG /
 * EmbedMolecule — `set_new_coords` is CoordGen, which is 2D only), so this
 * builds geometry itself. It is a *visualization* conformer: VSEPR-ideal
 * bond lengths and angles, relaxed until nothing overlaps. It is good enough
 * to see a molecule's shape, chirality and sterics in 3D. It is NOT an
 * energy-minimized conformer and must not be presented as one.
 *
 * Pipeline:
 *   1. Perceive hybridization per heavy atom (σ-domain count).
 *   2. Seed rings as rigid templates (planar polygon / cyclohexane chair).
 *   3. Grow the remaining acyclic atoms outward at ideal geometry.
 *   4. Attach implicit hydrogens at open coordination sites.
 *   5. Relax with a small force field (bonds, angles, soft nonbonded).
 */

import { covalentRadius } from '../model/elements'
import type { Bond, Molecule } from '../model/types'

export interface Atom3D {
  id: string
  element: string
  x: number
  y: number
  z: number
  charge: number
  /** True for hydrogens this module added (not present in the 2D graph). */
  implicit: boolean
}

export interface Conformer {
  atoms: Atom3D[]
  bonds: { a1: string; a2: string; order: 1 | 2 | 3 | 'aromatic' }[]
  /** Largest distance from the centroid, for framing the camera. */
  radius: number
}

type V3 = { x: number; y: number; z: number }

const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const len = (a: V3) => Math.sqrt(dot(a, a))
function norm(a: V3): V3 {
  const l = len(a)
  return l > 1e-9 ? scale(a, 1 / l) : { x: 1, y: 0, z: 0 }
}
/** Any unit vector perpendicular to `a`. */
function perp(a: V3): V3 {
  const ref = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  return norm(cross(a, ref))
}

/** Ideal bond length from covalent radii, shortened for higher bond orders. */
function idealBond(e1: string, e2: string, order: Bond['order']): number {
  const base = covalentRadius(e1) + covalentRadius(e2)
  if (order === 3) return base * 0.78
  if (order === 2) return base * 0.87
  if (order === 'aromatic') return base * 0.91
  return base
}

interface Ctx {
  ids: string[]
  index: Map<string, number>
  element: string[]
  charge: number[]
  neighbors: number[][]
  bondOrder: Map<string, Bond['order']>
  /** σ-domains including implicit H: decides hybridization. */
  domains: number[]
  hyb: ('sp' | 'sp2' | 'sp3')[]
  implicitH: number[]
  rings: number[][]
  inRing: boolean[]
  aromatic: boolean[]
}

const bondKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function buildContext(mol: Molecule): Ctx {
  const ids = mol.atoms.map((a) => a.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const neighbors: number[][] = Array.from({ length: n }, () => [])
  const bondOrder = new Map<string, Bond['order']>()

  for (const b of mol.bonds) {
    const i = index.get(b.a1)
    const j = index.get(b.a2)
    if (i === undefined || j === undefined) continue
    neighbors[i].push(j)
    neighbors[j].push(i)
    bondOrder.set(bondKey(i, j), b.order)
  }

  const element = mol.atoms.map((a) => a.element)
  const charge = mol.atoms.map((a) => a.charge ?? 0)
  const implicitH = mol.atoms.map((a) => a.implicitH ?? 0)

  // σ-domains = heavy neighbors + implicit H + lone pairs that shape geometry.
  // Only π bonds collapse a domain, so count each neighbor once.
  const domains: number[] = []
  const hyb: ('sp' | 'sp2' | 'sp3')[] = []
  for (let i = 0; i < n; i++) {
    let maxOrder = 1
    let aromaticHere = false
    for (const j of neighbors[i]) {
      const o = bondOrder.get(bondKey(i, j))
      if (o === 'aromatic') aromaticHere = true
      if (typeof o === 'number' && o > maxOrder) maxOrder = o
    }
    const sigma = neighbors[i].length + implicitH[i]
    domains.push(sigma)
    // Lone pairs on N/O/S still push toward sp3 geometry.
    const lonePairs = lonePairCount(element[i], neighbors[i].length, implicitH[i], charge[i])
    const steric = sigma + lonePairs
    if (aromaticHere || maxOrder === 2) hyb.push('sp2')
    else if (maxOrder === 3) hyb.push('sp')
    else hyb.push(steric >= 4 ? 'sp3' : steric === 3 ? 'sp2' : 'sp')
  }

  const rings = findRings(neighbors, n)
  const inRing = new Array(n).fill(false)
  for (const r of rings) for (const i of r) inRing[i] = true
  const aromatic = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    for (const j of neighbors[i]) {
      if (bondOrder.get(bondKey(i, j)) === 'aromatic') aromatic[i] = true
    }
  }

  return {
    ids,
    index,
    element,
    charge,
    neighbors,
    bondOrder,
    domains,
    hyb,
    implicitH,
    rings,
    inRing,
    aromatic,
  }
}

function lonePairCount(el: string, heavy: number, h: number, chg: number): number {
  const groups: Record<string, number> = { N: 5, P: 5, O: 6, S: 6, Se: 6, F: 7, Cl: 7, Br: 7, I: 7 }
  const ve = groups[el]
  if (ve === undefined) return 0
  const bonds = heavy + h
  const free = ve - bonds - chg
  return Math.max(0, Math.floor(free / 2))
}

/**
 * Smallest ring through each bond: drop the bond, then find the shortest
 * path back between its two endpoints — that path plus the bond is the
 * smallest cycle containing it.
 *
 * (A BFS that only looks for an edge back to the start atom cannot see
 * even-membered rings at all: the two search fronts meet at the far atom
 * and no edge ever returns directly to the seed. Benzene would come back
 * ring-free, and the ring would then be built as an open chain.)
 */
function findRings(neighbors: number[][], n: number): number[][] {
  const found = new Map<string, number[]>()
  const MAX_RING = 9

  for (let a = 0; a < n; a++) {
    for (const b of neighbors[a]) {
      if (b <= a) continue
      // Shortest a→b path that refuses the direct a–b bond.
      const prev = new Map<number, number>([[a, -1]])
      const queue = [a]
      let reached = false
      while (queue.length && !reached) {
        const cur = queue.shift()!
        for (const nb of neighbors[cur]) {
          if (cur === a && nb === b) continue // the bond we removed
          if (prev.has(nb)) continue
          prev.set(nb, cur)
          if (nb === b) {
            reached = true
            break
          }
          queue.push(nb)
        }
      }
      if (!reached) continue

      const cycle: number[] = []
      let c: number | undefined = b
      while (c !== undefined && c !== -1 && cycle.length <= MAX_RING) {
        cycle.push(c)
        if (c === a) break
        c = prev.get(c)
      }
      if (cycle.length < 3 || cycle.length > MAX_RING || cycle[cycle.length - 1] !== a) continue
      const key = [...cycle].sort((x, y) => x - y).join(',')
      if (!found.has(key)) found.set(key, cycle)
    }
  }
  return [...found.values()].sort((x, y) => x.length - y.length)
}

/** Ideal angle for a hybridization. */
function idealAngle(h: 'sp' | 'sp2' | 'sp3'): number {
  return h === 'sp' ? Math.PI : h === 'sp2' ? (120 * Math.PI) / 180 : (109.47 * Math.PI) / 180
}

/**
 * Directions for `count` substituents around an atom, given the directions
 * already taken by placed neighbors.
 */
function openDirections(
  hyb: 'sp' | 'sp2' | 'sp3',
  taken: V3[],
  count: number,
): V3[] {
  const out: V3[] = []
  const ang = idealAngle(hyb)

  if (taken.length === 0) {
    // Free atom: lay out the ideal polyhedron from scratch.
    if (hyb === 'sp') {
      out.push({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })
    } else if (hyb === 'sp2') {
      for (let i = 0; i < 3; i++) {
        const t = (i * 2 * Math.PI) / 3
        out.push({ x: Math.cos(t), y: Math.sin(t), z: 0 })
      }
    } else {
      const s = 1 / Math.sqrt(3)
      out.push(
        { x: s, y: s, z: s },
        { x: s, y: -s, z: -s },
        { x: -s, y: s, z: -s },
        { x: -s, y: -s, z: s },
      )
    }
    return out.slice(0, count)
  }

  if (taken.length === 1) {
    const a = norm(taken[0])
    const p = perp(a)
    const q = norm(cross(a, p))
    // Cone of directions at the ideal angle from the existing bond.
    const cosA = Math.cos(ang)
    const sinA = Math.sin(ang)
    for (let i = 0; i < count; i++) {
      const phi = (i * 2 * Math.PI) / Math.max(count, hyb === 'sp3' ? 3 : 2)
      const radial = add(scale(p, Math.cos(phi)), scale(q, Math.sin(phi)))
      out.push(norm(add(scale(a, cosA), scale(radial, sinA))))
    }
    return out
  }

  if (taken.length === 2) {
    const a = norm(taken[0])
    const b = norm(taken[1])
    const bisector = norm(add(a, b))
    const away = scale(bisector, -1)
    if (hyb === 'sp2' || count === 1) {
      out.push(away)
      if (count > 1) out.push(norm(cross(a, b)))
      return out.slice(0, count)
    }
    // sp3: the two remaining sites straddle the plane of the existing bonds.
    const axis = norm(cross(a, b))
    const half = (109.47 * Math.PI) / 180 / 2
    out.push(norm(add(scale(away, Math.cos(half)), scale(axis, Math.sin(half)))))
    out.push(norm(add(scale(away, Math.cos(half)), scale(axis, -Math.sin(half)))))
    return out.slice(0, count)
  }

  // Three taken: one site left, opposite their sum.
  const sum = taken.reduce((acc, t) => add(acc, norm(t)), { x: 0, y: 0, z: 0 })
  out.push(norm(scale(sum, -1)))
  return out.slice(0, count)
}

/** Place a ring as a rigid template: planar polygon, or a chair for saturated 6-rings. */
function ringTemplate(size: number, planar: boolean, bondLen: number): V3[] {
  const pts: V3[] = []
  if (planar || size !== 6) {
    // Regular polygon sized so its edges equal the bond length.
    const r = bondLen / (2 * Math.sin(Math.PI / size))
    for (let i = 0; i < size; i++) {
      const t = (i * 2 * Math.PI) / size
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z: 0 })
    }
    return pts
  }
  // Cyclohexane chair: alternate atoms above/below the mean plane. The
  // in-plane radius shrinks to keep the *3D* edge equal to the bond length
  // (edge² = r² + (2·zOff)² for a hexagon), otherwise every ring bond
  // starts ~12% long.
  const zRatio = 0.25
  const r = bondLen * Math.sqrt(Math.max(0.1, 1 - 4 * zRatio * zRatio))
  const zOff = bondLen * zRatio
  for (let i = 0; i < 6; i++) {
    const t = (i * 2 * Math.PI) / 6
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z: i % 2 === 0 ? zOff : -zOff })
  }
  return pts
}

/** Generate a 3D conformer for a 2D molecule graph. */
export function generateConformer(mol: Molecule): Conformer {
  const ctx = buildContext(mol)
  const n = ctx.ids.length
  if (n === 0) return { atoms: [], bonds: [], radius: 1 }

  const pos: (V3 | null)[] = new Array(n).fill(null)

  const bondLenBetween = (i: number, j: number) =>
    idealBond(ctx.element[i], ctx.element[j], ctx.bondOrder.get(bondKey(i, j)) ?? 1)

  // ---- 1. Place rings as rigid templates, then grow, alternating -------
  // Rings must be templated (a growth walk never closes a cycle), but a
  // ring can also be reachable only *through* a chain, so the two phases
  // take turns until everything is placed.
  const ringsToPlace = [...ctx.rings].sort((a, b) => b.length - a.length)
  const ringDone = new Set<number>()

  const placeRings = (): boolean => {
    let progress = false
    for (let ri = 0; ri < ringsToPlace.length; ri++) {
      if (ringDone.has(ri)) continue
      const ring = ringsToPlace[ri]
      if (ring.every((i) => pos[i] !== null)) {
        ringDone.add(ri)
        continue
      }
      const known = ring.filter((i) => pos[i] !== null)
      const anyPlaced = pos.filter((p) => p !== null).length > 0
      // Nothing anchored yet anywhere: this ring seeds the molecule.
      if (known.length === 0 && anyPlaced) continue

      const planar = ring.some((i) => ctx.aromatic[i]) || ring.some((i) => ctx.hyb[i] === 'sp2')
      let avgLen = 0
      for (let k = 0; k < ring.length; k++) {
        avgLen += bondLenBetween(ring[k], ring[(k + 1) % ring.length])
      }
      avgLen /= ring.length
      const template = ringTemplate(ring.length, planar, avgLen)

      if (known.length === 0) {
        ring.forEach((atom, k) => (pos[atom] = template[k]))
      } else if (known.length === 1) {
        // Spiro / ring hanging off a chain: pin the shared atom, point the
        // ring away from whatever that atom is already bonded to.
        const anchor = known[0]
        const ai = ring.indexOf(anchor)
        const occupied = ctx.neighbors[anchor]
          .filter((j) => pos[j] !== null && !ring.includes(j))
          .map((j) => sub(pos[j]!, pos[anchor]!))
        const away =
          occupied.length > 0
            ? norm(scale(occupied.reduce((acc, v) => add(acc, norm(v)), { x: 0, y: 0, z: 0 }), -1))
            : { x: 1, y: 0, z: 0 }
        // Ring centroid should sit along `away` from the anchor.
        const centroidLocal = template.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 })
        const c = scale(centroidLocal, 1 / template.length)
        const vFrom = norm(sub(c, template[ai]))
        const rot = rotationBetween(vFrom, away)
        for (let k = 0; k < ring.length; k++) {
          const atom = ring[k]
          if (pos[atom] !== null) continue
          pos[atom] = add(pos[anchor]!, rot(sub(template[k], template[ai])))
        }
      } else {
        // Fused ring: align the template onto the shared edge.
        const i0 = ring.indexOf(known[0])
        const i1 = ring.indexOf(known[1])
        if (i0 < 0 || i1 < 0) continue
        const vFrom = norm(sub(template[i1], template[i0]))
        const vTo = norm(sub(pos[known[1]]!, pos[known[0]]!))
        const rot = rotationBetween(vFrom, vTo)
        for (let k = 0; k < ring.length; k++) {
          const atom = ring[k]
          if (pos[atom] !== null) continue
          pos[atom] = add(pos[known[0]]!, rot(sub(template[k], template[i0])))
        }
      }
      ringDone.add(ri)
      progress = true
    }
    return progress
  }

  const growOnce = (): boolean => {
    let progress = false
    for (let i = 0; i < n; i++) {
      if (pos[i] === null) continue
      const unplaced = ctx.neighbors[i].filter((j) => pos[j] === null)
      if (unplaced.length === 0) continue
      const taken = ctx.neighbors[i]
        .filter((j) => pos[j] !== null)
        .map((j) => sub(pos[j]!, pos[i]!))
      const dirs = openDirections(ctx.hyb[i], taken, unplaced.length)
      unplaced.forEach((j, k) => {
        const d = dirs[k] ?? dirs[dirs.length - 1] ?? { x: 1, y: 0, z: 0 }
        pos[j] = add(pos[i]!, scale(norm(d), bondLenBetween(i, j)))
      })
      progress = true
    }
    return progress
  }

  if (pos.filter((p) => p !== null).length === 0 && ringsToPlace.length === 0) {
    pos[0] = { x: 0, y: 0, z: 0 }
  }

  let guard = 0
  while (pos.filter((p) => p !== null).length < n && guard++ < n * 4 + 8) {
    const ringProgress = placeRings()
    const growProgress = growOnce()
    if (!ringProgress && !growProgress) {
      // Disconnected fragment: seed it clear of what's already placed.
      const idx = pos.findIndex((p) => p === null)
      if (idx < 0) break
      pos[idx] = { x: 6 + idx * 0.4, y: 0, z: 0 }
    }
  }
  for (let i = 0; i < n; i++) if (pos[i] === null) pos[i] = { x: i * 1.5, y: 0, z: 0 }

  // ---- 3. Attach implicit hydrogens ------------------------------------
  const atoms: Atom3D[] = ctx.ids.map((id, i) => ({
    id,
    element: ctx.element[i],
    x: pos[i]!.x,
    y: pos[i]!.y,
    z: pos[i]!.z,
    charge: ctx.charge[i],
    implicit: false,
  }))
  const bonds: Conformer['bonds'] = mol.bonds
    .filter((b) => ctx.index.has(b.a1) && ctx.index.has(b.a2))
    .map((b) => ({ a1: b.a1, a2: b.a2, order: b.order }))

  for (let i = 0; i < n; i++) {
    const hCount = ctx.implicitH[i]
    if (hCount <= 0) continue
    const taken = ctx.neighbors[i].map((j) => sub(pos[j]!, pos[i]!))
    const dirs = openDirections(ctx.hyb[i], taken, hCount)
    const hLen = idealBond(ctx.element[i], 'H', 1)
    for (let k = 0; k < hCount; k++) {
      const d = dirs[k] ?? perp(taken[0] ?? { x: 1, y: 0, z: 0 })
      const hid = `${ctx.ids[i]}_h${k}`
      const p = add(pos[i]!, scale(norm(d), hLen))
      atoms.push({ id: hid, element: 'H', x: p.x, y: p.y, z: p.z, charge: 0, implicit: true })
      bonds.push({ a1: ctx.ids[i], a2: hid, order: 1 })
    }
  }

  relax(atoms, bonds, ctx)
  return finish(atoms, bonds)
}

/** Returns a function rotating vectors so direction `from` lands on `to`. */
function rotationBetween(from: V3, to: V3): (v: V3) => V3 {
  const a = norm(from)
  const b = norm(to)
  const axis = cross(a, b)
  const axisLen = len(axis)
  const angle = Math.atan2(axisLen, dot(a, b))
  const unit = axisLen > 1e-6 ? scale(axis, 1 / axisLen) : perp(a)
  return (v: V3) => rotateAxis(v, unit, angle)
}

function rotateAxis(v: V3, axis: V3, angle: number): V3 {
  // Rodrigues' rotation
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(
    add(scale(v, c), scale(cross(axis, v), s)),
    scale(axis, dot(axis, v) * (1 - c)),
  )
}

/**
 * Steepest-descent relaxation: bond lengths, bond angles, and a soft
 * nonbonded repulsion so independently-placed fragments stop overlapping.
 * Enough to make geometry believable; deliberately not a real force field.
 */
function relax(atoms: Atom3D[], bonds: Conformer['bonds'], ctx: Ctx) {
  const idx = new Map(atoms.map((a, i) => [a.id, i]))
  const n = atoms.length
  if (n < 2) return

  const bondList = bonds
    .map((b) => {
      const i = idx.get(b.a1)!
      const j = idx.get(b.a2)!
      return { i, j, r0: idealBond(atoms[i].element, atoms[j].element, b.order) }
    })
    .filter((b) => b.i !== undefined && b.j !== undefined)

  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const b of bondList) {
    adj[b.i].push(b.j)
    adj[b.j].push(b.i)
  }

  // Angle triples i-j-k around each center j.
  const angles: { i: number; j: number; k: number; t0: number }[] = []
  for (let j = 0; j < n; j++) {
    const nb = adj[j]
    if (nb.length < 2) continue
    const heavyIdx = ctx.index.get(atoms[j].id)
    const h = heavyIdx !== undefined ? ctx.hyb[heavyIdx] : 'sp3'
    const t0 = idealAngle(h)
    for (let a = 0; a < nb.length; a++) {
      for (let b = a + 1; b < nb.length; b++) {
        angles.push({ i: nb[a], j, k: nb[b], t0 })
      }
    }
  }

  const bonded = new Set(bondList.map((b) => bondKey(b.i, b.j)))
  const oneThree = new Set(angles.map((a) => bondKey(a.i, a.k)))

  // Bigger molecules have more coupled strain to work out — a fused
  // polycyclic core needs several times the passes a small chain does.
  const STEPS = Math.min(1100, 300 + n * 8)
  const step = 0.045
  for (let iter = 0; iter < STEPS; iter++) {
    const grad: V3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }))

    // `grad` holds dE/dp, and positions step along -grad. For a bond,
    // dE/dp_i = -2(r - r0) * d/r with d = p_j - p_i, so a too-long bond
    // pulls i toward j. Getting this sign backwards makes the whole
    // relaxation run in reverse (bonds collapse instead of settling).
    for (const b of bondList) {
      const d = sub(atoms[b.j], atoms[b.i])
      const r = len(d)
      if (r < 1e-6) continue
      // Bonds are weighted well above angles: in a strained fused cage the
      // two constraints genuinely conflict, and a wrong bond length is far
      // more visible than a few degrees of angle strain.
      const dir = scale(d, (5 * (r - b.r0)) / r)
      grad[b.i] = sub(grad[b.i], dir)
      grad[b.j] = add(grad[b.j], dir)
    }

    for (const a of angles) {
      const v1 = sub(atoms[a.i], atoms[a.j])
      const v2 = sub(atoms[a.k], atoms[a.j])
      const l1 = len(v1)
      const l2 = len(v2)
      if (l1 < 1e-6 || l2 < 1e-6) continue
      const c = Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)))
      const theta = Math.acos(c)
      const diff = theta - a.t0
      if (Math.abs(diff) < 1e-4) continue
      const s = Math.sqrt(Math.max(1e-8, 1 - c * c))
      const kAng = 0.55
      const f = (kAng * diff) / s
      const g1 = scale(sub(scale(v2, 1 / (l1 * l2)), scale(v1, c / (l1 * l1))), f)
      const g2 = scale(sub(scale(v1, 1 / (l1 * l2)), scale(v2, c / (l2 * l2))), f)
      grad[a.i] = sub(grad[a.i], g1)
      grad[a.k] = sub(grad[a.k], g2)
      grad[a.j] = add(grad[a.j], add(g1, g2))
    }

    // Soft repulsion for atoms that aren't bonded or 1-3 related.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = bondKey(i, j)
        if (bonded.has(key) || oneThree.has(key)) continue
        let d = sub(atoms[j], atoms[i])
        let r2 = dot(d, d)
        const rMin = covalentRadius(atoms[i].element) + covalentRadius(atoms[j].element) + 0.55
        if (r2 > rMin * rMin) continue
        if (r2 < 1e-6) {
          // Exactly coincident atoms have no separation direction, so the
          // repulsion term is degenerate. Nudge them apart deterministically.
          d = { x: ((i * 7 + j) % 5) * 0.01 + 0.01, y: ((i * 3 + j) % 7) * 0.01, z: ((i + j) % 3) * 0.01 }
          r2 = dot(d, d)
        }
        const r = Math.sqrt(r2)
        const dir = scale(d, (2.2 * (r - rMin)) / r)
        grad[i] = sub(grad[i], dir)
        grad[j] = add(grad[j], dir)
      }
    }

    for (let i = 0; i < n; i++) {
      const g = grad[i]
      const gl = len(g)
      const capped = gl > 0.6 ? scale(g, 0.6 / gl) : g
      atoms[i].x -= capped.x * step
      atoms[i].y -= capped.y * step
      atoms[i].z -= capped.z * step
    }
  }
}

/** Center at the origin and report the bounding radius. */
function finish(atoms: Atom3D[], bonds: Conformer['bonds']): Conformer {
  if (atoms.length === 0) return { atoms, bonds, radius: 1 }
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
