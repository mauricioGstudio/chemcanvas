import { docBounds, moleculeToMolblock } from '../model/graph'
import type { Molecule } from '../model/types'
import { useDocStore } from '../state/doc'
import { useEditorStore } from '../state/editor'
import { toast } from '../ui/Toasts'
import { getRDKit } from './rdkit'

/**
 * Export pipeline. Chemistry formats go through RDKit; images are built by
 * capturing the live canvas SVG (so exports match the screen exactly), then
 * resolving theme variables to publication black-on-white.
 */

export function download(data: Blob | string, filename: string, mime = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function targetMolecules(): Molecule[] {
  const { selection } = useEditorStore.getState()
  const all = useDocStore.getState().molecules
  if (selection.atomIds.size > 0) {
    const withSel = all.filter((m) => m.atoms.some((a) => selection.atomIds.has(a.id)))
    if (withSel.length > 0) return withSel
  }
  return all
}

/** Combined V2000 molblock of the whole canvas (disconnected fragments allowed). */
function combinedMolblock(): string | null {
  const mols = targetMolecules()
  if (mols.length === 0) return null
  if (mols.length === 1) return moleculeToMolblock(mols[0])
  const combined: Molecule = {
    id: 'export',
    atoms: mols.flatMap((m) => m.atoms),
    bonds: mols.flatMap((m) => m.bonds),
  }
  return moleculeToMolblock(combined)
}

export function exportMol(v3000 = false) {
  try {
    const mb = combinedMolblock()
    if (!mb) return toast('Nothing to export yet.', 'info')
    if (!v3000) {
      download(mb, 'structure.mol', 'chemical/x-mdl-molfile')
    } else {
      const RDKit = getRDKit()
      const mol = RDKit.get_mol(mb)
      if (!mol) return toast('RDKit could not parse the structure.', 'error')
      try {
        download(mol.get_v3Kmolblock(), 'structure-v3000.mol', 'chemical/x-mdl-molfile')
      } finally {
        mol.delete()
      }
    }
    toast('Exported .mol file.', 'success')
  } catch {
    toast('Export failed — fix flagged valence issues first.', 'error')
  }
}

export function exportSDF() {
  try {
    const mols = targetMolecules()
    if (mols.length === 0) return toast('Nothing to export yet.', 'info')
    const records = mols.map((m) => `${moleculeToMolblock(m).trimEnd()}\n$$$$`)
    download(records.join('\n') + '\n', 'structures.sdf', 'chemical/x-mdl-sdfile')
    toast(`Exported ${mols.length} structure${mols.length > 1 ? 's' : ''} as SDF.`, 'success')
  } catch {
    toast('Export failed — fix flagged valence issues first.', 'error')
  }
}

export function exportSmilesFile() {
  try {
    const RDKit = getRDKit()
    const mols = targetMolecules()
    if (mols.length === 0) return toast('Nothing to export yet.', 'info')
    const lines: string[] = []
    for (const m of mols) {
      const mol = RDKit.get_mol(moleculeToMolblock(m))
      if (!mol) continue
      try {
        lines.push(mol.get_smiles())
      } finally {
        mol.delete()
      }
    }
    download(lines.join('\n') + '\n', 'structures.smi', 'chemical/x-daylight-smiles')
    toast('Exported SMILES.', 'success')
  } catch {
    toast('Export failed — fix flagged valence issues first.', 'error')
  }
}

export function exportInChIFile() {
  try {
    const RDKit = getRDKit()
    const mols = targetMolecules()
    if (mols.length === 0) return toast('Nothing to export yet.', 'info')
    const lines: string[] = []
    for (const m of mols) {
      const mol = RDKit.get_mol(moleculeToMolblock(m))
      if (!mol) continue
      try {
        lines.push(mol.get_inchi())
      } finally {
        mol.delete()
      }
    }
    download(lines.join('\n') + '\n', 'structures.inchi', 'chemical/x-inchi')
    toast('Exported InChI.', 'success')
  } catch {
    toast('Export failed — fix flagged valence issues first.', 'error')
  }
}

/** Theme-variable → publication color mapping for exported vectors. */
const EXPORT_COLORS: [string, string][] = [
  ['var(--stroke-mol)', '#111111'],
  ['var(--canvas)', '#ffffff'],
  ['var(--text-secondary)', '#555555'],
  ['var(--text-muted)', '#777777'],
  ['var(--font-ui)', 'Inter, Helvetica, Arial, sans-serif'],
  ['var(--font-mono)', 'JetBrains Mono, Menlo, monospace'],
  ['var(--warning)', 'transparent'], // valence dots don't belong in exports
  ['var(--accent-subtle)', 'transparent'],
  ['var(--accent)', 'transparent'],
  ['var(--error)', 'transparent'],
]

export interface SvgExport {
  svg: string
  w: number
  h: number
}

/** Capture the world layer as a standalone black-on-white SVG. */
export function buildExportSvg(pad = 48): SvgExport | null {
  const world = document.querySelector('main svg g[transform]')
  if (!world) return null
  const doc = useDocStore.getState()
  let bounds = docBounds(doc.molecules)
  // include arrows / labels / brackets in the bounding box
  const extend = (x: number, y: number) => {
    if (!bounds) bounds = { minX: x, minY: y, maxX: x, maxY: y }
    else {
      bounds = {
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x),
        maxY: Math.max(bounds.maxY, y),
      }
    }
  }
  for (const r of doc.reactions) {
    extend(r.x, r.y)
    if (r.x2 !== undefined && r.y2 !== undefined) extend(r.x2, r.y2)
    else extend(r.x + r.length * Math.cos(r.angle ?? 0), r.y + r.length * Math.sin(r.angle ?? 0))
  }
  for (const l of doc.labels) {
    extend(l.x, l.y - l.fontSize)
    extend(l.x + l.text.length * l.fontSize * 0.62, l.y + 4)
  }
  for (const b of doc.brackets) {
    extend(b.x - 6, b.y - 6)
    extend(b.x + b.w + 24, b.y + b.h + 10)
  }
  if (!bounds) return null

  const clone = world.cloneNode(true) as SVGGElement
  clone.removeAttribute('transform')
  // Strip interaction-only nodes: hit targets, ghosts, selection halos
  clone.querySelectorAll('[stroke="transparent"], [fill="transparent"]').forEach((n) => n.remove())
  clone.querySelectorAll('.pointer-events-none, foreignObject').forEach((n) => n.remove())

  let markup = clone.outerHTML
  for (const [from, to] of EXPORT_COLORS) {
    markup = markup.split(from).join(to)
  }

  const minX = bounds.minX - pad
  const minY = bounds.minY - pad
  const w = bounds.maxX - bounds.minX + pad * 2
  const h = bounds.maxY - bounds.minY + pad * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>${markup}</svg>`
  return { svg, w, h }
}

export function exportSVG() {
  const out = buildExportSvg()
  if (!out) return toast('Nothing to export yet.', 'info')
  download(out.svg, 'structure.svg', 'image/svg+xml')
  toast('Exported clean SVG.', 'success')
}

export function renderPngBlob(dpi: number): Promise<Blob | null> {
  const out = buildExportSvg()
  if (!out) return Promise.resolve(null)
  const scale = dpi / 96
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(out.w * scale)
      canvas.height = Math.round(out.h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    }
    img.onerror = () => resolve(null)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg)
  })
}

export async function exportPNG(dpi: number) {
  const blob = await renderPngBlob(dpi)
  if (!blob) return toast('Nothing to export yet.', 'info')
  download(blob, `structure-${dpi}dpi.png`, 'image/png')
  toast(`Exported PNG at ${dpi} DPI.`, 'success')
}

export async function exportPDF() {
  const out = buildExportSvg()
  if (!out) return toast('Nothing to export yet.', 'info')
  const blob = await renderPngBlob(300)
  if (!blob) return toast('PDF export failed.', 'error')
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({
    orientation: out.w >= out.h ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [out.w, out.h],
  })
  pdf.addImage(dataUrl, 'PNG', 0, 0, out.w, out.h)
  pdf.save('structure.pdf')
  toast('Exported PDF.', 'success')
}

/** ⌘⇧C — copy the canvas as a PNG image. */
export async function copyAsImage() {
  const blob = await renderPngBlob(192)
  if (!blob) return toast('Nothing to copy yet.', 'info')
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast('Copied image to clipboard.', 'success')
  } catch {
    toast('Clipboard images unavailable — use Export → PNG instead.', 'error')
  }
}
