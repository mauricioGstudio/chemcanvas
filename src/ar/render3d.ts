/**
 * Ball-and-stick 3D renderer on a plain 2D canvas.
 *
 * No WebGL and no 3D library: molecules are a few dozen spheres and sticks,
 * which the painter's algorithm handles comfortably at 60fps. Spheres are
 * radial gradients (a lit sphere is exactly what a radial gradient looks
 * like), bonds are depth-sorted quads split at the midpoint so each half
 * takes its own atom's color. This keeps the AR bundle small and avoids a
 * second rendering stack alongside the existing SVG canvas.
 */

import { cpkColor, vdwRadius } from '../model/elements'
import type { Atom3D, Conformer } from '../chem/conformer'

export type DisplayMode = 'ball-stick' | 'spacefill' | 'wireframe'

export interface ViewState {
  /** Rotation quaternion-free: yaw/pitch/roll in radians. */
  yaw: number
  pitch: number
  roll: number
  /** Screen-space center. */
  cx: number
  cy: number
  /** Pixels per Ångström. */
  scale: number
}

export interface RenderOptions {
  mode: DisplayMode
  showLabels: boolean
  /** Draw hydrogens the conformer added. */
  showHydrogens: boolean
  /** Slight fog so depth reads clearly against a camera feed. */
  depthCue: boolean
}

interface Projected {
  x: number
  y: number
  z: number
  r: number
  atom: Atom3D
}

function rotate(a: Atom3D, v: ViewState) {
  const cy = Math.cos(v.yaw)
  const sy = Math.sin(v.yaw)
  const cp = Math.cos(v.pitch)
  const sp = Math.sin(v.pitch)
  const cr = Math.cos(v.roll)
  const sr = Math.sin(v.roll)

  // yaw (Y) → pitch (X) → roll (Z)
  let x = a.x * cy + a.z * sy
  let z = -a.x * sy + a.z * cy
  let y = a.y

  const y2 = y * cp - z * sp
  z = y * sp + z * cp
  y = y2

  const x2 = x * cr - y * sr
  y = x * sr + y * cr
  x = x2

  return { x, y, z }
}

type RGB = [number, number, number]

/**
 * Colors are carried as numeric triples and only stringified at the point
 * of use. Mixing on strings invites feeding an `rgb(...)` result back into
 * a hex parser, which silently yields NaN channels.
 */
function parseHex(hex: string): RGB {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ]
}

function mix(from: RGB, target: RGB, t: number): RGB {
  return [
    Math.round(from[0] + (target[0] - from[0]) * t),
    Math.round(from[1] + (target[1] - from[1]) * t),
    Math.round(from[2] + (target[2] - from[2]) * t),
  ]
}

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`

/** Background the depth cue fades toward. */
const FOG: RGB = [12, 14, 20]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

function sphereRadius(el: string, mode: DisplayMode): number {
  if (mode === 'spacefill') return vdwRadius(el)
  if (mode === 'wireframe') return 0.12
  // Ball-and-stick: scaled-down vdW keeps relative atom sizes readable.
  return el === 'H' ? 0.26 : 0.34 + (vdwRadius(el) - 1.5) * 0.12
}

/**
 * Draw the conformer. Returns nothing; the canvas is cleared by the caller
 * so the camera feed underneath stays visible.
 */
export function renderConformer(
  ctx: CanvasRenderingContext2D,
  conf: Conformer,
  view: ViewState,
  opts: RenderOptions,
) {
  const atomById = new Map(conf.atoms.map((a) => [a.id, a]))
  const visible = (a: Atom3D) => opts.showHydrogens || !a.implicit

  const projected = new Map<string, Projected>()
  for (const a of conf.atoms) {
    if (!visible(a)) continue
    const r = rotate(a, view)
    projected.set(a.id, {
      x: view.cx + r.x * view.scale,
      y: view.cy - r.y * view.scale,
      z: r.z,
      r: sphereRadius(a.element, opts.mode) * view.scale,
      atom: a,
    })
  }

  // Depth range for fog + draw order.
  let zMin = Infinity
  let zMax = -Infinity
  for (const p of projected.values()) {
    zMin = Math.min(zMin, p.z)
    zMax = Math.max(zMax, p.z)
  }
  const zSpan = Math.max(zMax - zMin, 1e-6)
  const fog = (z: number) => (opts.depthCue ? 0.55 * (1 - (z - zMin) / zSpan) : 0)

  interface Item {
    z: number
    draw: () => void
  }
  const items: Item[] = []

  // ---- bonds ----
  if (opts.mode !== 'spacefill') {
    for (const b of conf.bonds) {
      const p1 = projected.get(b.a1)
      const p2 = projected.get(b.a2)
      if (!p1 || !p2) continue
      const a1 = atomById.get(b.a1)!
      const a2 = atomById.get(b.a2)!
      const mz = (p1.z + p2.z) / 2
      const width = Math.max(1.5, view.scale * (opts.mode === 'wireframe' ? 0.045 : 0.09))
      const orders = b.order === 3 ? 3 : b.order === 2 ? 2 : 1
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const l = Math.hypot(dx, dy) || 1
      // Offset multi-bonds perpendicular to the bond in screen space.
      const ox = (-dy / l) * width * 1.25
      const oy = (dx / l) * width * 1.25

      items.push({
        z: mz,
        draw: () => {
          for (let k = 0; k < orders; k++) {
            const t = orders === 1 ? 0 : k - (orders - 1) / 2
            const sx = ox * t
            const sy = oy * t
            const mx = (p1.x + p2.x) / 2 + sx
            const my = (p1.y + p2.y) / 2 + sy
            ctx.lineCap = 'round'
            ctx.lineWidth = width
            ctx.strokeStyle = rgb(mix(parseHex(cpkColor(a1.element)), FOG, fog(p1.z)))
            ctx.beginPath()
            ctx.moveTo(p1.x + sx, p1.y + sy)
            ctx.lineTo(mx, my)
            ctx.stroke()
            ctx.strokeStyle = rgb(mix(parseHex(cpkColor(a2.element)), FOG, fog(p2.z)))
            ctx.beginPath()
            ctx.moveTo(mx, my)
            ctx.lineTo(p2.x + sx, p2.y + sy)
            ctx.stroke()
          }
        },
      })
    }
  }

  // ---- atoms ----
  for (const p of projected.values()) {
    items.push({
      z: p.z,
      draw: () => {
        const base = parseHex(cpkColor(p.atom.element))
        const f = fog(p.z)
        const lit = mix(base, WHITE, 0.55)
        const dark = mix(base, BLACK, 0.45)
        const r0 = Math.max(0.01, p.r * 0.05)
        const r1 = Math.max(r0 + 0.01, p.r)
        const g = ctx.createRadialGradient(
          p.x - p.r * 0.35,
          p.y - p.r * 0.4,
          r0,
          p.x,
          p.y,
          r1,
        )
        g.addColorStop(0, rgb(mix(lit, FOG, f)))
        g.addColorStop(0.55, rgb(mix(base, FOG, f)))
        g.addColorStop(1, rgb(mix(dark, FOG, f)))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()

        // Rim keeps light atoms legible over a bright camera feed.
        ctx.lineWidth = Math.max(0.6, p.r * 0.06)
        ctx.strokeStyle = `rgba(0,0,0,${0.35 - f * 0.2})`
        ctx.stroke()

        if (opts.showLabels && p.atom.element !== 'H' && p.r > 7) {
          ctx.font = `600 ${Math.round(p.r * 0.95)}px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#fff'
          ctx.strokeStyle = 'rgba(0,0,0,0.65)'
          ctx.lineWidth = Math.max(1.5, p.r * 0.12)
          ctx.strokeText(p.atom.element, p.x, p.y)
          ctx.fillText(p.atom.element, p.x, p.y)
        }
      },
    })
  }

  items.sort((a, b) => a.z - b.z)
  for (const it of items) it.draw()
}

/** Scale that fits the conformer inside a viewport with margin. */
export function fitScale(conf: Conformer, width: number, height: number): number {
  const min = Math.min(width, height)
  return (min * 0.38) / Math.max(conf.radius, 1)
}
