import { useState } from 'react'
import { MOD } from './platform'

const TOUR_KEY = 'chemcanvas:tour-done'

interface Step {
  title: string
  body: string
  /** Rough anchor position on screen. */
  place: React.CSSProperties
}

const STEPS: Step[] = [
  {
    title: 'The canvas',
    body: 'Draw here. Scroll to zoom, hold Space (or middle-click) to pan. Click near an atom or bond to select it — no pixel-hunting.',
    place: { left: '50%', top: '40%', transform: 'translate(-50%, -50%)' },
  },
  {
    title: 'Tools',
    body: 'Atoms, bonds, rings, chains, arrows, text, eraser. Hover any tool for its shortcut — S, A, B, R, T, E work anywhere.',
    place: { left: 240, top: 56 },
  },
  {
    title: 'One search bar for everything',
    body: `Press ${MOD}K and type a molecule name (caffeine), paste a SMILES string, or run a command (“export png”).`,
    place: { left: '50%', top: 56, transform: 'translateX(-50%)' },
  },
  {
    title: 'Live properties',
    body: 'Formula, MW, SMILES, InChI — always in sync with your drawing, computed by RDKit. Select an atom or bond for its own panel.',
    place: { right: 280, top: 120 },
  },
]

export function tourDone(): boolean {
  return localStorage.getItem(TOUR_KEY) === '1'
}

export default function Onboarding() {
  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(tourDone)

  if (dismissed) return null
  const done = () => {
    localStorage.setItem(TOUR_KEY, '1')
    setDismissed(true)
  }
  const s = STEPS[step]

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        className="pointer-events-auto absolute w-[300px] rounded-[10px] border border-edge-strong bg-panel p-4 shadow-2xl"
        style={s.place}
        role="dialog"
        aria-label={`Tour step ${step + 1} of ${STEPS.length}: ${s.title}`}
      >
        <div className="flex items-center justify-between pb-1">
          <span className="text-[13px] font-medium text-primary">{s.title}</span>
          <span className="font-mono text-[11px] text-muted">
            {step + 1}/{STEPS.length}
          </span>
        </div>
        <p className="pb-3 text-[13px] leading-relaxed text-secondary">{s.body}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={done}
            className="rounded-[6px] px-2 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-hover hover:text-primary"
          >
            Skip tour
          </button>
          <div className="flex-1" />
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-[6px] border border-edge px-2.5 py-1 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover"
            >
              Back
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : done())}
            className="rounded-[6px] bg-accent-subtle px-2.5 py-1 text-[12px] font-medium text-accent transition-colors duration-150 hover:opacity-85"
          >
            {step < STEPS.length - 1 ? 'Next' : 'Start drawing'}
          </button>
        </div>
      </div>
    </div>
  )
}
