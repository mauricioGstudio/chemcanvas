import {
  Check,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  Loader2,
  Search,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  failureKind,
  isAbort,
  opsinByName,
  pubchemAutocomplete,
  pubchemByName,
  type CompoundResult,
} from '../chem/naming'
import { checkSmiles } from '../chem/smiles'
import { placeStructureFromSmiles } from '../state/actions'
import { useUIStore } from '../state/store'
import { matchCommands, type Command } from './commands'
import { MOD } from './platform'
import { toast } from './Toasts'

type Entry =
  | { type: 'command'; command: Command }
  | { type: 'smiles'; smiles: string; formulaText: string }
  | { type: 'compound'; name: string; result?: CompoundResult; loading: boolean }

interface SearchState {
  status: 'idle' | 'searching' | 'done' | 'busy' | 'network' | 'empty'
  compounds: Entry[]
}

export default function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen)
  const setOpen = useUIStore((s) => s.setPaletteOpen)
  const rdkitReady = useUIStore((s) => s.rdkitReady)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ status: 'idle', compounds: [] })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const smilesCheck = useMemo(
    () => (rdkitReady && query.trim() ? checkSmiles(query) : { isSmiles: false, valid: false }),
    [query, rdkitReady],
  )
  const commandHits = useMemo(() => matchCommands(query), [query])

  // Debounced name lookup
  useEffect(() => {
    abortRef.current?.abort()
    setActive(0)
    const q = query.trim()
    if (!open || !q || smilesCheck.isSmiles || q.length < 3) {
      setSearch({ status: 'idle', compounds: [] })
      return
    }
    const ctl = new AbortController()
    abortRef.current = ctl
    setSearch((s) => ({ ...s, status: 'searching' }))

    const timer = setTimeout(async () => {
      try {
        let terms = await pubchemAutocomplete(q, 5, ctl.signal)
        if (ctl.signal.aborted) return
        if (terms.length === 0) {
          // OPSIN fallback for strict IUPAC nomenclature
          try {
            const opsin = await opsinByName(q, ctl.signal)
            const check = checkSmiles(opsin.smiles)
            setSearch({
              status: 'done',
              compounds: [
                {
                  type: 'compound',
                  name: q,
                  loading: false,
                  result: { ...opsin, formula: check.formulaText },
                },
              ],
            })
          } catch (err) {
            if (isAbort(err)) return
            setSearch({ status: 'empty', compounds: [] })
          }
          return
        }
        terms = terms.slice(0, 5)
        setSearch({
          status: 'done',
          compounds: terms.map((t) => ({ type: 'compound', name: t, loading: true })),
        })
        // Fill in formula/MW per term as they resolve
        terms.forEach((t) => {
          pubchemByName(t, ctl.signal)
            .then((result) => {
              if (ctl.signal.aborted) return
              setSearch((s) => ({
                ...s,
                compounds: s.compounds.map((e) =>
                  e.type === 'compound' && e.name === t ? { ...e, result, loading: false } : e,
                ),
              }))
            })
            .catch((err) => {
              if (isAbort(err)) return
              setSearch((s) => ({
                ...s,
                compounds: s.compounds.map((e) =>
                  e.type === 'compound' && e.name === t ? { ...e, loading: false } : e,
                ),
              }))
            })
        })
      } catch (err) {
        if (isAbort(err)) return
        // PubChem unreachable — a strict IUPAC name can still resolve via OPSIN.
        try {
          const opsin = await opsinByName(q, ctl.signal)
          const check = checkSmiles(opsin.smiles)
          setSearch({
            status: 'done',
            compounds: [
              {
                type: 'compound',
                name: q,
                loading: false,
                result: { ...opsin, formula: check.formulaText },
              },
            ],
          })
          return
        } catch (opsinErr) {
          if (isAbort(opsinErr)) return
        }
        const kind = failureKind(err)
        setSearch({ status: kind === 'busy' ? 'busy' : kind === 'network' ? 'network' : 'empty', compounds: [] })
      }
    }, 350)

    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [query, open, smilesCheck.isSmiles])

  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = []
    if (smilesCheck.isSmiles && smilesCheck.valid) {
      out.push({ type: 'smiles', smiles: query.trim(), formulaText: smilesCheck.formulaText ?? '' })
    }
    for (const c of commandHits) out.push({ type: 'command', command: c })
    out.push(...search.compounds)
    return out
  }, [smilesCheck, commandHits, search.compounds, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSearch({ status: 'idle', compounds: [] })
    setActive(0)
  }, [setOpen])

  const runEntry = useCallback(
    async (entry: Entry) => {
      if (entry.type === 'command') {
        close()
        entry.command.run()
        return
      }
      if (entry.type === 'smiles') {
        const placed = placeStructureFromSmiles(entry.smiles)
        if (placed) close()
        else toast('That SMILES string could not be parsed.', 'error')
        return
      }
      // compound
      let result = entry.result
      if (!result) {
        try {
          result = await pubchemByName(entry.name)
        } catch {
          toast("Couldn't fetch that structure. Try a different name or paste a SMILES string.", 'error')
          return
        }
      }
      const placed = placeStructureFromSmiles(result.smiles, result.name)
      if (placed) close()
      else toast("Couldn't build that structure. Try a different name or paste a SMILES string.", 'error')
    },
    [close],
  )

  // Focus on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Keep active row in view
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const status = search.status
  const showEmptyHint = !query.trim()

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Search or run a command"
    >
      <div
        className="mx-auto mt-[12vh] w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[10px] border border-edge-strong bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, entries.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const entry = entries[active] ?? entries[0]
                if (entry) void runEntry(entry)
              }
            }}
            placeholder="Search or type a molecule name…"
            aria-label="Search or type a molecule name"
            className="h-11 w-full bg-transparent text-[15px] text-primary placeholder:text-muted focus:outline-none"
          />
          {smilesCheck.isSmiles && smilesCheck.valid && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-success">
              <Check size={13} /> {smilesCheck.formulaText}
            </span>
          )}
          {query.trim().length > 2 && !smilesCheck.isSmiles && status === 'searching' && (
            <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
          )}
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5" role="listbox">
          {showEmptyHint && (
            <div className="px-3 py-6 text-center text-[13px] text-muted">
              Type a molecule name (caffeine), a SMILES string, or a command (zoom to fit)…
            </div>
          )}

          {entries.map((entry, i) => {
            const isActive = i === active
            const base = `flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
              isActive ? 'bg-active text-primary' : 'text-secondary hover:bg-hover'
            }`
            if (entry.type === 'command') {
              return (
                <button
                  key={`c-${entry.command.id}`}
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={base}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void runEntry(entry)}
                >
                  <Terminal size={14} className="shrink-0 text-muted" />
                  <span className="flex-1">{entry.command.title}</span>
                  {entry.command.shortcut && (
                    <kbd className="rounded-[4px] border border-edge bg-toolbar px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {entry.command.shortcut}
                    </kbd>
                  )}
                </button>
              )
            }
            if (entry.type === 'smiles') {
              return (
                <button
                  key="smiles"
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={base}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void runEntry(entry)}
                >
                  <FlaskConical size={14} className="shrink-0 text-success" />
                  <span className="flex-1">
                    Place structure from SMILES
                    <span className="ml-2 font-mono text-[11px] text-muted">{entry.formulaText}</span>
                  </span>
                  <ChevronRight size={13} className="shrink-0 text-muted" />
                </button>
              )
            }
            return (
              <button
                key={`m-${entry.name}`}
                data-idx={i}
                type="button"
                role="option"
                aria-selected={isActive}
                className={base}
                onMouseEnter={() => setActive(i)}
                onClick={() => void runEntry(entry)}
              >
                <FlaskConical size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-primary">{entry.name}</span>
                  {entry.result?.iupacName && entry.result.iupacName.toLowerCase() !== entry.name.toLowerCase() && (
                    <span className="block truncate text-[11px] text-muted">{entry.result.iupacName}</span>
                  )}
                </span>
                {entry.loading ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-muted" />
                ) : entry.result?.formula ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {entry.result.formula}
                    {entry.result.mw ? ` · ${entry.result.mw.toFixed(2)}` : ''}
                  </span>
                ) : null}
              </button>
            )
          })}

          {status === 'empty' && query.trim().length > 2 && !smilesCheck.isSmiles && entries.length === commandHits.length && (
            <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-muted">
              <CircleAlert size={14} className="shrink-0" />
              Couldn't find that one. Try a different name or paste a SMILES string.
            </div>
          )}
          {status === 'busy' && (
            <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-warning">
              <CircleAlert size={14} className="shrink-0" />
              PubChem is busy right now — give it a moment and try again.
            </div>
          )}
          {status === 'network' && (
            <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-muted">
              <CircleAlert size={14} className="shrink-0" />
              Couldn't reach the lookup service. Check your connection or paste a SMILES string.
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-edge px-4 py-2 text-[11px] text-muted">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> place / run
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
          <span className="flex-1" />
          <span className="font-mono">{MOD}K</span>
        </div>
      </div>
    </div>
  )
}
