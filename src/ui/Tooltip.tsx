import { useState } from 'react'

/**
 * Minimal hover tooltip: name + shortcut, below the target.
 * Rich enough to teach shortcuts passively (§5.4), light enough to be instant.
 */
export default function Tip({
  label,
  shortcut,
  children,
  side = 'bottom',
}: {
  label: string
  shortcut?: string
  children: React.ReactNode
  side?: 'bottom' | 'top'
}) {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-[6px] border border-edge bg-panel px-2 py-1 text-[11px] whitespace-nowrap text-primary shadow-lg ${
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
        >
          {label}
          {shortcut && (
            <kbd className="rounded-[4px] border border-edge bg-toolbar px-1 font-mono text-[10px] text-muted">
              {shortcut}
            </kbd>
          )}
        </span>
      )}
    </span>
  )
}
