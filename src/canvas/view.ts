/** View transform: screen = world * zoom + offset(x, y). World units are px at 100% zoom. */
export interface ViewTransform {
  x: number
  y: number
  zoom: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 16

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export function screenToWorld(v: ViewTransform, sx: number, sy: number) {
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom }
}

export function worldToScreen(v: ViewTransform, wx: number, wy: number) {
  return { x: wx * v.zoom + v.x, y: wy * v.zoom + v.y }
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(v: ViewTransform, sx: number, sy: number, factor: number): ViewTransform {
  const zoom = clampZoom(v.zoom * factor)
  if (zoom === v.zoom) return v
  const w = screenToWorld(v, sx, sy)
  return { zoom, x: sx - w.x * zoom, y: sy - w.y * zoom }
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function padBox(b: Box, pad: number): Box {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

/** View that fits `bounds` into a viewport of (w, h) with margin, zoom clamped. */
export function fitBox(bounds: Box, w: number, h: number, margin = 48, maxZoom = 1.5): ViewTransform {
  const bw = Math.max(bounds.maxX - bounds.minX, 1)
  const bh = Math.max(bounds.maxY - bounds.minY, 1)
  const zoom = clampZoom(Math.min((w - margin * 2) / bw, (h - margin * 2) / bh, maxZoom))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return { zoom, x: w / 2 - cx * zoom, y: h / 2 - cy * zoom }
}
