import { Maximize, Minus, Plus } from 'lucide-react'
import { useEditorStore } from '../state/editor'
import { useUIStore } from '../state/store'

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded-[4px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
    >
      {children}
    </button>
  )
}

export default function BottomBar() {
  const { rdkitReady, rdkitVersion, rdkitError } = useUIStore()
  const cursor = useEditorStore((s) => s.cursor)
  const zoom = useEditorStore((s) => s.view.zoom)
  const { zoomCentered, setZoom, fitView } = useEditorStore.getState()

  return (
    <footer className="no-print flex h-7 shrink-0 items-center gap-4 border-t border-edge bg-toolbar px-3 font-mono text-[11px] text-muted">
      <span>
        {rdkitError
          ? `chemistry engine failed: ${rdkitError}`
          : rdkitReady
            ? `RDKit ${rdkitVersion}`
            : 'loading chemistry engine…'}
      </span>

      <div className="flex-1" />

      <span className="tabular-nums">
        {cursor ? `x ${cursor.x.toFixed(1)}  y ${cursor.y.toFixed(1)}` : ''}
      </span>

      <div className="flex items-center gap-1">
        <ZoomButton label="Zoom out (Ctrl+-)" onClick={() => zoomCentered(1 / 1.25)}>
          <Minus size={12} strokeWidth={1.75} />
        </ZoomButton>
        <button
          type="button"
          aria-label="Reset zoom to 100% (Ctrl+1)"
          title="Reset zoom to 100% (Ctrl+1)"
          onClick={() => setZoom(1)}
          className="min-w-[44px] rounded-[4px] px-1 text-center tabular-nums text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomButton label="Zoom in (Ctrl+=)" onClick={() => zoomCentered(1.25)}>
          <Plus size={12} strokeWidth={1.75} />
        </ZoomButton>
        <ZoomButton label="Zoom to fit (Ctrl+0)" onClick={() => fitView(null)}>
          <Maximize size={12} strokeWidth={1.75} />
        </ZoomButton>
      </div>
    </footer>
  )
}
