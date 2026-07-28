import { buildRingTemplate } from '../model/templates'
import type { Molecule } from '../model/types'
import { useDocStore } from '../state/doc'
import { bondAngles, dist2, openDirection, type Pt } from './geometry'

/** Forgiving hit-testing (§5.2): tolerances are screen px converted by caller. */

export interface AtomHit {
  molId: string
  atomId: string
  x: number
  y: number
}

export interface BondHit {
  molId: string
  bondId: string
}

export function hitAtomAt(world: Pt, tol: number): AtomHit | null {
  let best: { hit: AtomHit; d: number } | null = null
  for (const m of useDocStore.getState().molecules) {
    for (const a of m.atoms) {
      const d = dist2(a, world)
      if (d <= tol * tol && (!best || d < best.d)) {
        best = { hit: { molId: m.id, atomId: a.id, x: a.x, y: a.y }, d }
      }
    }
  }
  return best?.hit ?? null
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  if (l2 === 0) return dist2(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2
  t = Math.max(0, Math.min(1, t))
  return dist2(p, { x: a.x + abx * t, y: a.y + aby * t })
}

export function hitBondAt(world: Pt, tol: number): BondHit | null {
  let best: { hit: BondHit; d: number } | null = null
  for (const m of useDocStore.getState().molecules) {
    const pos = new Map(m.atoms.map((a) => [a.id, a]))
    for (const b of m.bonds) {
      const a1 = pos.get(b.a1)
      const a2 = pos.get(b.a2)
      if (!a1 || !a2) continue
      const d = segDist2(world, a1, a2)
      if (d <= tol * tol && (!best || d < best.d)) best = { hit: { molId: m.id, bondId: b.id }, d }
    }
  }
  return best?.hit ?? null
}

/** All atoms/bonds inside a marquee rectangle or lasso polygon. */
export function itemsInRect(r: { x1: number; y1: number; x2: number; y2: number }): {
  atomIds: string[]
  bondIds: string[]
} {
  const minX = Math.min(r.x1, r.x2)
  const maxX = Math.max(r.x1, r.x2)
  const minY = Math.min(r.y1, r.y2)
  const maxY = Math.max(r.y1, r.y2)
  const atomIds: string[] = []
  const bondIds: string[] = []
  for (const m of useDocStore.getState().molecules) {
    const inside = new Set<string>()
    for (const a of m.atoms) {
      if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) {
        atomIds.push(a.id)
        inside.add(a.id)
      }
    }
    for (const b of m.bonds) {
      if (inside.has(b.a1) && inside.has(b.a2)) bondIds.push(b.id)
    }
  }
  return { atomIds, bondIds }
}

export function itemsInPolygon(
  poly: Pt[],
  contains: (p: Pt, poly: Pt[]) => boolean,
): { atomIds: string[]; bondIds: string[] } {
  const atomIds: string[] = []
  const bondIds: string[] = []
  for (const m of useDocStore.getState().molecules) {
    const inside = new Set<string>()
    for (const a of m.atoms) {
      if (contains(a, poly)) {
        atomIds.push(a.id)
        inside.add(a.id)
      }
    }
    for (const b of m.bonds) {
      if (inside.has(b.a1) && inside.has(b.a2)) bondIds.push(b.id)
    }
  }
  return { atomIds, bondIds }
}

// ---------- Ring placement geometry ----------

function transformMol(
  mol: Molecule,
  fn: (p: Pt) => Pt,
): Molecule {
  return { ...mol, atoms: mol.atoms.map((a) => ({ ...a, ...fn(a) })) }
}

function centroid(mol: Molecule): Pt {
  const n = mol.atoms.length || 1
  return {
    x: mol.atoms.reduce((s, a) => s + a.x, 0) / n,
    y: mol.atoms.reduce((s, a) => s + a.y, 0) / n,
  }
}

function rotateAbout(p: Pt, c: Pt, ang: number): Pt {
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/**
 * Compute the placed geometry for a ring template given what's under the
 * cursor. The same function feeds the ghost preview and the actual insert, so
 * what you see is exactly what you get.
 *
 * - over an atom: the ring shares that atom, extending in the open direction
 * - over a bond: the ring fuses along that bond, on its emptier side
 * - otherwise: centered at the cursor
 */
export function ringPlacement(
  templateId: string,
  cursor: Pt,
  hover: { atomId: string | null; bondId: string | null },
): Molecule | null {
  const template = buildRingTemplate(templateId)
  if (!template) return null
  const doc = useDocStore.getState().molecules

  if (hover.atomId) {
    for (const m of doc) {
      const a = m.atoms.find((x) => x.id === hover.atomId)
      if (!a) continue
      const theta = openDirection(m, a.id)
      const c0 = centroid(template)
      const v = template.atoms[0]
      const r = Math.hypot(v.x - c0.x, v.y - c0.y)
      const phi = Math.atan2(v.y - c0.y, v.x - c0.x)
      const targetCenter: Pt = { x: a.x + Math.cos(theta) * r, y: a.y + Math.sin(theta) * r }
      const delta = theta + Math.PI - phi
      return transformMol(template, (p) => {
        const rp = rotateAbout(p, c0, delta)
        return { x: rp.x - c0.x + targetCenter.x, y: rp.y - c0.y + targetCenter.y }
      })
    }
  }

  if (hover.bondId) {
    for (const m of doc) {
      const b = m.bonds.find((x) => x.id === hover.bondId)
      if (!b) continue
      const p1 = m.atoms.find((x) => x.id === b.a1)!
      const p2 = m.atoms.find((x) => x.id === b.a2)!
      // Emptier side of the bond: away from the neighbors' centroid
      const nbs = [...bondAngles(m, b.a1), ...bondAngles(m, b.a2)]
      void nbs
      const others = m.atoms.filter((x) => x.id !== b.a1 && x.id !== b.a2)
      const mid: Pt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const nx = -(p2.y - p1.y)
      const ny = p2.x - p1.x
      let sideScore = 0
      for (const o of others) sideScore += Math.sign((o.x - mid.x) * nx + (o.y - mid.y) * ny)
      const wantSide = sideScore > 0 ? -1 : 1

      // Template edge: first bond
      const tb = template.bonds[0]
      const t1 = template.atoms.find((x) => x.id === tb.a1)!
      const t2 = template.atoms.find((x) => x.id === tb.a2)!

      const place = (from1: Pt, from2: Pt): Molecule => {
        const angT = Math.atan2(from2.y - from1.y, from2.x - from1.x)
        const angB = Math.atan2(p2.y - p1.y, p2.x - p1.x)
        const scale = Math.hypot(p2.x - p1.x, p2.y - p1.y) / (Math.hypot(from2.x - from1.x, from2.y - from1.y) || 1)
        const rot = angB - angT
        const cos = Math.cos(rot) * scale
        const sin = Math.sin(rot) * scale
        return transformMol(template, (p) => {
          const dx = p.x - from1.x
          const dy = p.y - from1.y
          return { x: p1.x + dx * cos - dy * sin, y: p1.y + dx * sin + dy * cos }
        })
      }

      let placed = place(t1, t2)
      const c = centroid(placed)
      const side = Math.sign((c.x - mid.x) * nx + (c.y - mid.y) * ny)
      if (side !== wantSide) placed = place(t2, t1)
      return placed
    }
  }

  const c0 = centroid(template)
  return transformMol(template, (p) => ({ x: p.x - c0.x + cursor.x, y: p.y - c0.y + cursor.y }))
}
