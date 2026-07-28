import { BOND_LENGTH } from '../model/graph'
import type { Molecule } from '../model/types'

export interface Pt {
  x: number
  y: number
}

export const SNAP_DEG = 30

/**
 * Snap a dragged bond endpoint: nearest 30° ray at standard bond length
 * around `origin`. With `free` (Alt held), the raw point is used.
 */
export function snapBondEnd(origin: Pt, p: Pt, free: boolean): Pt {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const dist = Math.hypot(dx, dy)
  if (free) {
    if (dist < 1e-6) return { x: origin.x + BOND_LENGTH, y: origin.y }
    return p
  }
  const step = (SNAP_DEG * Math.PI) / 180
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step
  return {
    x: origin.x + Math.cos(snapped) * BOND_LENGTH,
    y: origin.y + Math.sin(snapped) * BOND_LENGTH,
  }
}

/** Angles (radians) of all bonds leaving `atomId`. */
export function bondAngles(mol: Molecule, atomId: string): number[] {
  const a = mol.atoms.find((x) => x.id === atomId)
  if (!a) return []
  const out: number[] = []
  for (const b of mol.bonds) {
    const otherId = b.a1 === atomId ? b.a2 : b.a2 === atomId ? b.a1 : null
    if (!otherId) continue
    const o = mol.atoms.find((x) => x.id === otherId)
    if (o) out.push(Math.atan2(o.y - a.y, o.x - a.x))
  }
  return out
}

function angDist(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

/**
 * Predictive growth (§5.2): the direction a new bond should take from an atom —
 * the most open direction, preferring clean 120° geometry.
 */
export function openDirection(mol: Molecule, atomId: string): number {
  const angles = bondAngles(mol, atomId)
  if (angles.length === 0) return -Math.PI / 6 // 30° up-right for a fresh atom

  if (angles.length === 1) {
    // Continue a zig-zag: ±120° from the existing bond; prefer the upward fork
    const base = angles[0]
    const c1 = base + (2 * Math.PI) / 3
    const c2 = base - (2 * Math.PI) / 3
    return Math.sin(c1) <= Math.sin(c2) ? c1 : c2
  }

  // Most open 30°-multiple direction
  let best = 0
  let bestScore = -1
  for (let k = 0; k < 12; k++) {
    const cand = (k * Math.PI) / 6
    const score = Math.min(...angles.map((a) => angDist(a, cand)))
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = cand
    }
  }
  return best
}

/** Points of an n-carbon zig-zag chain from `origin` toward `target`. */
export function chainPoints(origin: Pt, target: Pt, startAngleHint?: number): Pt[] {
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const dist = Math.hypot(dx, dy)
  const n = Math.max(1, Math.round(dist / (BOND_LENGTH * Math.cos(Math.PI / 6))))
  const dir = Math.atan2(dy, dx)
  // Zig-zag along dir: alternate ±30° around the axis
  const pts: Pt[] = []
  let cur = { ...origin }
  for (let i = 0; i < n; i++) {
    const wob = (i % 2 === 0 ? -1 : 1) * (Math.PI / 6)
    const a = dir + wob * (startAngleHint !== undefined && i === 0 ? Math.sign(startAngleHint) || 1 : 1)
    cur = { x: cur.x + Math.cos(a) * BOND_LENGTH, y: cur.y + Math.sin(a) * BOND_LENGTH }
    pts.push(cur)
  }
  return pts
}

export function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Point-in-polygon (lasso select). */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
