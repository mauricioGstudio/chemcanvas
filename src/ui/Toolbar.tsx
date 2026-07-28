import {
  ChevronDown,
  Eraser,
  Hexagon,
  Moon,
  MousePointer2,
  MoveRight,
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  Sun,
  Type,
  Undo2,
  Waypoints,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RING_TEMPLATES } from '../model/templates'
import { redo, undo, useHistory } from '../state/doc'
import { useEditorStore, type BondStereoTool } from '../state/editor'
import { useUIStore } from '../state/store'
import { combo, MOD, SHIFT } from './platform'
import ExportMenu from './ExportMenu'
import Tip from './Tooltip'
import type { ReactionKind, Tool } from '../model/types'

const PICKER_ELEMENTS = ['C', 'H', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I', 'Si', 'B', 'Se', 'Te', 'As', 'Ge']

function BarButton({
  label,
  shortcut,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:opacity-40
          ${active ? 'bg-accent-subtle text-accent' : 'text-secondary hover:bg-hover hover:text-primary'}`}
      >
        {children}
      </button>
    </Tip>
  )
}

/** Inline SVG glyphs for bond variants. */
function BondGlyph({ kind }: { kind: 1 | 2 | 3 | BondStereoTool }) {
  const s = 'var(--text-secondary)'
  if (kind === 1 || kind === 'none')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  if (kind === 2)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <line x1="2.5" y1="11.5" x2="11.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="5.5" y1="14" x2="14" y2="5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  if (kind === 3)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <line x1="1.5" y1="10.5" x2="10.5" y2="1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="4.5" y1="13" x2="13" y2="4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="7" y1="15" x2="15" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  if (kind === 'wedge')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <polygon points="3,13 12,2 14,5" fill="currentColor" />
      </svg>
    )
  if (kind === 'dash')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        {[0, 1, 2, 3, 4].map((i) => {
          const t = i / 4
          const w = 1 + t * 3
          const x = 3 + t * 9
          const y = 13 - t * 10
          return <line key={i} x1={x - w} y1={y + w * 0.4} x2={x + w} y2={y - w * 0.4} stroke="currentColor" strokeWidth="1.4" />
        })}
      </svg>
    )
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M 3 13 Q 5 9 7 11 T 11 7 T 13 3" fill="none" stroke={s} strokeWidth="1.4" />
    </svg>
  )
}

function Picker({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      className="absolute top-full left-0 z-50 mt-1.5 rounded-[10px] border border-edge-strong bg-panel p-1.5 shadow-2xl"
    >
      {children}
    </div>
  )
}

export default function Toolbar() {
  const ui = useUIStore()
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const currentElement = useEditorStore((s) => s.currentElement)
  const currentBondOrder = useEditorStore((s) => s.currentBondOrder)
  const currentBondStereo = useEditorStore((s) => s.currentBondStereo)
  const currentRing = useEditorStore((s) => s.currentRing)
  const currentArrow = useEditorStore((s) => s.currentArrow)
  const { canUndo, canRedo } = useHistory()
  const [picker, setPicker] = useState<'element' | 'bond' | 'ring' | 'arrow' | null>(null)
  const [customEl, setCustomEl] = useState('')

  const pick = (t: Tool) => {
    setTool(t)
    setPicker(null)
  }

  return (
    <header className="no-print relative z-30 flex h-11 shrink-0 items-center gap-1.5 border-b border-edge bg-toolbar px-3">
      <BarButton
        label={ui.leftOpen ? 'Hide templates panel' : 'Show templates panel'}
        onClick={ui.toggleLeft}
        active={false}
      >
        <PanelLeft size={15} strokeWidth={1.75} />
      </BarButton>

      <span className="hidden pr-1 pl-1 text-[13px] font-medium tracking-tight text-primary select-none sm:inline">
        ChemCanvas
      </span>

      <div className="mx-1 h-5 w-px bg-(--border)" />

      <BarButton label="Select" shortcut="S" onClick={() => pick('select')} active={tool === 'select'}>
        <MousePointer2 size={15} strokeWidth={1.75} />
      </BarButton>

      {/* Atom tool + element picker */}
      <span className="relative inline-flex">
        <BarButton label={`Atom · ${currentElement}`} shortcut="A" onClick={() => pick('atom')} active={tool === 'atom'}>
          <span className="text-[13px] leading-none font-semibold">{currentElement}</span>
        </BarButton>
        <button
          type="button"
          aria-label="Choose element"
          onClick={() => setPicker(picker === 'element' ? null : 'element')}
          className="-ml-1 flex h-7 w-3.5 items-center justify-center rounded-[4px] text-muted hover:text-primary"
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
        <Picker open={picker === 'element'} onClose={() => setPicker(null)}>
          <div className="grid w-[176px] grid-cols-4 gap-1">
            {PICKER_ELEMENTS.map((el) => (
              <button
                key={el}
                type="button"
                onClick={() => {
                  useEditorStore.getState().setCurrentElement(el)
                  setPicker(null)
                }}
                className={`flex h-8 items-center justify-center rounded-[6px] text-[13px] font-medium transition-colors duration-150 ${
                  currentElement === el ? 'bg-accent-subtle text-accent' : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                {el}
              </button>
            ))}
          </div>
          <form
            className="mt-1.5 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const el = customEl.trim()
              const norm = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase()
              if (norm) {
                useEditorStore.getState().setCurrentElement(norm)
                setCustomEl('')
                setPicker(null)
              }
            }}
          >
            <input
              value={customEl}
              onChange={(e) => setCustomEl(e.target.value)}
              placeholder="Symbol…"
              maxLength={2}
              className="h-7 w-full rounded-[6px] border border-edge bg-toolbar px-2 text-[12px] text-primary placeholder:text-muted focus:outline-none"
            />
            <button type="submit" className="rounded-[6px] border border-edge px-2 text-[11px] text-secondary hover:bg-hover">
              Set
            </button>
          </form>
        </Picker>
      </span>

      {/* Bond tool + variant picker */}
      <span className="relative inline-flex">
        <BarButton label="Bond" shortcut="B" onClick={() => pick('bond')} active={tool === 'bond'}>
          <BondGlyph kind={currentBondStereo !== 'none' ? currentBondStereo : currentBondOrder} />
        </BarButton>
        <button
          type="button"
          aria-label="Choose bond type"
          onClick={() => setPicker(picker === 'bond' ? null : 'bond')}
          className="-ml-1 flex h-7 w-3.5 items-center justify-center rounded-[4px] text-muted hover:text-primary"
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
        <Picker open={picker === 'bond'} onClose={() => setPicker(null)}>
          <div className="flex w-[196px] flex-col gap-0.5">
            {(
              [
                { kind: 1 as const, label: 'Single', shortcut: '1' },
                { kind: 2 as const, label: 'Double', shortcut: '2' },
                { kind: 3 as const, label: 'Triple', shortcut: '3' },
                { kind: 'wedge' as const, label: 'Wedge (up)' },
                { kind: 'dash' as const, label: 'Dashed wedge (down)' },
                { kind: 'wavy' as const, label: 'Wavy (undefined)' },
              ] as { kind: 1 | 2 | 3 | BondStereoTool; label: string; shortcut?: string }[]
            ).map((v) => {
              const activeVariant =
                typeof v.kind === 'number'
                  ? currentBondStereo === 'none' && currentBondOrder === v.kind
                  : currentBondStereo === v.kind
              return (
                <button
                  key={String(v.kind)}
                  type="button"
                  onClick={() => {
                    const editor = useEditorStore.getState()
                    if (typeof v.kind === 'number') editor.setCurrentBondOrder(v.kind)
                    else editor.setCurrentBondStereo(v.kind)
                    setPicker(null)
                  }}
                  className={`flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                    activeVariant ? 'bg-accent-subtle text-accent' : 'text-secondary hover:bg-hover hover:text-primary'
                  }`}
                >
                  <BondGlyph kind={v.kind} />
                  <span className="flex-1">{v.label}</span>
                  {v.shortcut && <kbd className="font-mono text-[10px] text-muted">{v.shortcut}</kbd>}
                </button>
              )
            })}
          </div>
        </Picker>
      </span>

      {/* Ring tool + template picker */}
      <span className="relative inline-flex">
        <BarButton label={`Ring · ${RING_TEMPLATES.find((r) => r.id === currentRing)?.name ?? ''}`} shortcut="R" onClick={() => pick('ring')} active={tool === 'ring'}>
          <Hexagon size={15} strokeWidth={1.75} />
        </BarButton>
        <button
          type="button"
          aria-label="Choose ring template"
          onClick={() => setPicker(picker === 'ring' ? null : 'ring')}
          className="-ml-1 flex h-7 w-3.5 items-center justify-center rounded-[4px] text-muted hover:text-primary"
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
        <Picker open={picker === 'ring'} onClose={() => setPicker(null)}>
          <div className="grid max-h-[280px] w-[196px] grid-cols-1 gap-0.5 overflow-y-auto">
            {RING_TEMPLATES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  useEditorStore.getState().setCurrentRing(r.id)
                  setPicker(null)
                }}
                className={`rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                  currentRing === r.id ? 'bg-accent-subtle text-accent' : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </Picker>
      </span>

      {/* Reaction arrow tool + kind picker */}
      <span className="relative inline-flex">
        <BarButton label="Reaction arrow" onClick={() => pick('arrow')} active={tool === 'arrow'}>
          <MoveRight size={15} strokeWidth={1.75} />
        </BarButton>
        <button
          type="button"
          aria-label="Choose arrow type"
          onClick={() => setPicker(picker === 'arrow' ? null : 'arrow')}
          className="-ml-1 flex h-7 w-3.5 items-center justify-center rounded-[4px] text-muted hover:text-primary"
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
        <Picker open={picker === 'arrow'} onClose={() => setPicker(null)}>
          <div className="flex w-[196px] flex-col gap-0.5">
            {(
              [
                { kind: 'forward', glyph: '⟶', label: 'Forward' },
                { kind: 'equilibrium', glyph: '⇌', label: 'Equilibrium' },
                { kind: 'retro', glyph: '⟹', label: 'Retrosynthetic' },
                { kind: 'resonance', glyph: '⟷', label: 'Resonance' },
                { kind: 'curly', glyph: '↷', label: 'Curly (electron push)' },
              ] as { kind: ReactionKind; glyph: string; label: string }[]
            ).map((v) => (
              <button
                key={v.kind}
                type="button"
                onClick={() => {
                  useEditorStore.getState().setCurrentArrow(v.kind)
                  setPicker(null)
                }}
                className={`flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                  currentArrow === v.kind ? 'bg-accent-subtle text-accent' : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                <span className="w-5 text-center text-[15px]">{v.glyph}</span>
                <span className="flex-1">{v.label}</span>
              </button>
            ))}
          </div>
        </Picker>
      </span>

      <BarButton label="Chain" onClick={() => pick('chain')} active={tool === 'chain'}>
        <Waypoints size={15} strokeWidth={1.75} />
      </BarButton>
      <BarButton label="Text" shortcut="T" onClick={() => pick('text')} active={tool === 'text'}>
        <Type size={15} strokeWidth={1.75} />
      </BarButton>
      <BarButton label="Eraser" shortcut="E" onClick={() => pick('eraser')} active={tool === 'eraser'}>
        <Eraser size={15} strokeWidth={1.75} />
      </BarButton>

      <div className="mx-1 h-5 w-px bg-(--border)" />

      <BarButton label="Undo" shortcut={combo(MOD, 'Z')} onClick={undo} disabled={!canUndo}>
        <Undo2 size={15} strokeWidth={1.75} />
      </BarButton>
      <BarButton label="Redo" shortcut={combo(MOD, SHIFT, 'Z')} onClick={redo} disabled={!canRedo}>
        <Redo2 size={15} strokeWidth={1.75} />
      </BarButton>

      <div className="flex-1" />

      <ExportMenu />

      <button
        type="button"
        onClick={() => ui.setPaletteOpen(true)}
        className="flex h-7 items-center gap-2 rounded-[6px] border border-edge bg-panel px-2.5 text-[12px] text-muted transition-colors duration-150 hover:border-edge-strong hover:text-secondary"
        aria-label={`Search molecules or run a command (${combo(MOD, 'K')})`}
      >
        <Search size={13} strokeWidth={1.75} />
        <span className="hidden md:inline">Search…</span>
        <kbd className="hidden font-mono text-[11px] md:inline">{combo(MOD, 'K')}</kbd>
      </button>

      <BarButton
        label={ui.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={ui.toggleTheme}
      >
        {ui.theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
      </BarButton>
      <BarButton
        label={ui.rightOpen ? 'Hide properties panel' : 'Show properties panel'}
        onClick={ui.toggleRight}
      >
        <PanelRight size={15} strokeWidth={1.75} />
      </BarButton>
    </header>
  )
}
