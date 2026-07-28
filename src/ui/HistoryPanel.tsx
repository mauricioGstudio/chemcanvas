import { X } from 'lucide-react'
import { useStore } from 'zustand'
import { useDocStore, type DocSnapshot } from '../state/doc'
import { useUIStore } from '../state/store'

/**
 * Visual history (⌘⇧H): labeled steps, click to jump back/forward with
 * confidence (§5.3). Steps are described by their content summary.
 */

function describe(s: DocSnapshot): string {
  const atoms = s.molecules.reduce((n, m) => n + m.atoms.length, 0)
  const parts = [`${s.molecules.length} struct`, `${atoms} atoms`]
  if (s.reactions.length) parts.push(`${s.reactions.length} arrows`)
  if (s.labels.length) parts.push(`${s.labels.length} labels`)
  return parts.join(' · ')
}

export default function HistoryPanel() {
  const open = useUIStore((s) => s.historyOpen)
  const setOpen = useUIStore((s) => s.setHistoryOpen)
  const past = useStore(useDocStore.temporal, (s) => s.pastStates)
  const future = useStore(useDocStore.temporal, (s) => s.futureStates)
  const molecules = useDocStore((s) => s.molecules)
  const reactions = useDocStore((s) => s.reactions)
  const labels = useDocStore((s) => s.labels)
  const brackets = useDocStore((s) => s.brackets)
  const current: DocSnapshot = { molecules, reactions, labels, brackets }

  if (!open) return null

  const jumpBack = (steps: number) => useDocStore.temporal.getState().undo(steps)
  const jumpForward = (steps: number) => useDocStore.temporal.getState().redo(steps)

  return (
    <div className="no-print absolute top-14 right-4 z-30 w-[240px] overflow-hidden rounded-[10px] border border-edge-strong bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-[13px] font-medium text-primary">History</span>
        <button
          type="button"
          aria-label="Close history"
          onClick={() => setOpen(false)}
          className="flex h-5 w-5 items-center justify-center rounded-[4px] text-muted hover:bg-hover hover:text-primary"
        >
          <X size={12} />
        </button>
      </div>
      <div className="max-h-[320px] overflow-y-auto p-1.5">
        {past.length === 0 && future.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-muted">No steps yet — start drawing.</p>
        )}
        {past.map((s, i) => (
          <button
            key={`p${i}`}
            type="button"
            onClick={() => jumpBack(past.length - i)}
            className="flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1 text-left transition-colors duration-150 hover:bg-hover"
          >
            <span className="font-mono text-[10px] text-muted">{i + 1}</span>
            <span className="text-[12px] text-secondary">{describe(s as DocSnapshot)}</span>
          </button>
        ))}
        <div className="flex w-full items-baseline gap-2 rounded-[6px] bg-accent-subtle px-2 py-1">
          <span className="font-mono text-[10px] text-accent">{past.length + 1}</span>
          <span className="text-[12px] font-medium text-accent">{describe(current)} — now</span>
        </div>
        {future
          .slice()
          .reverse()
          .map((s, i) => (
            <button
              key={`f${i}`}
              type="button"
              onClick={() => jumpForward(i + 1)}
              className="flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1 text-left opacity-60 transition-colors duration-150 hover:bg-hover hover:opacity-100"
            >
              <span className="font-mono text-[10px] text-muted">{past.length + 2 + i}</span>
              <span className="text-[12px] text-secondary">{describe(s as DocSnapshot)}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
