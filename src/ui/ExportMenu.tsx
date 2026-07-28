import { ChevronDown, Download, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  copyAsImage,
  exportInChIFile,
  exportMol,
  exportPDF,
  exportPNG,
  exportSDF,
  exportSmilesFile,
  exportSVG,
} from '../chem/export'
import { importFiles } from '../chem/import'
import { combo, MOD, SHIFT } from './platform'
import Tip from './Tooltip'

function MenuItem({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[13px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
    >
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] text-muted">{hint}</span>}
    </button>
  )
}

export default function ExportMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const run = (fn: () => void | Promise<void>) => () => {
    setOpen(false)
    void fn()
  }

  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".mol,.sdf,.smi,.smiles,.inchi,.rxn,.cdx,.cdxml"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <Tip label="Open file (.mol, .sdf, .smi…)">
        <button
          type="button"
          aria-label="Open a structure file"
          onClick={() => fileRef.current?.click()}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
        >
          <FolderOpen size={15} strokeWidth={1.75} />
        </button>
      </Tip>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
      >
        <Download size={14} strokeWidth={1.75} />
        <span className="hidden lg:inline">Export</span>
        <ChevronDown size={10} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1.5 w-[220px] rounded-[10px] border border-edge-strong bg-panel p-1 shadow-2xl"
        >
          <div className="px-2.5 pt-1 pb-0.5 text-[10px] tracking-wide text-muted uppercase">Image</div>
          <div className="flex items-center gap-1 px-2.5 pb-1">
            <span className="flex-1 text-[13px] text-secondary">PNG</span>
            {[72, 150, 300, 600].map((dpi) => (
              <button
                key={dpi}
                type="button"
                onClick={run(() => exportPNG(dpi))}
                className="rounded-[4px] border border-edge px-1.5 py-0.5 font-mono text-[10px] text-secondary hover:bg-hover hover:text-primary"
              >
                {dpi}
              </button>
            ))}
          </div>
          <MenuItem label="SVG (clean vector)" onClick={run(exportSVG)} />
          <MenuItem label="PDF" onClick={run(exportPDF)} />
          <MenuItem label="Copy as image" hint={combo(MOD, SHIFT, 'C')} onClick={run(copyAsImage)} />
          <div className="my-1 h-px bg-(--border)" />
          <div className="px-2.5 pt-0.5 pb-0.5 text-[10px] tracking-wide text-muted uppercase">Chemistry</div>
          <MenuItem label="Molfile (V2000)" onClick={run(() => exportMol(false))} />
          <MenuItem label="Molfile (V3000)" onClick={run(() => exportMol(true))} />
          <MenuItem label="SDF (all structures)" onClick={run(exportSDF)} />
          <MenuItem label="SMILES (.smi)" onClick={run(exportSmilesFile)} />
          <MenuItem label="InChI (.inchi)" onClick={run(exportInChIFile)} />
        </div>
      )}
    </div>
  )
}
