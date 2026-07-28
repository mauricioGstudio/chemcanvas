import { AlertCircle, Check, Info } from 'lucide-react'
import { create } from 'zustand'

export type ToastKind = 'success' | 'info' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: ToastItem[]
  push: (message: string, kind: ToastKind) => void
  dismiss: (id: number) => void
}

let nextId = 1

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Fire-and-forget notification. All feedback goes through here — no modals. */
export function toast(message: string, kind: ToastKind = 'info') {
  useToastStore.getState().push(message, kind)
}

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <Check size={14} strokeWidth={2} className="shrink-0 text-success" />,
  info: <Info size={14} strokeWidth={2} className="shrink-0 text-accent" />,
  error: <AlertCircle size={14} strokeWidth={2} className="shrink-0 text-danger" />,
}

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed top-14 right-4 z-50 flex w-[320px] flex-col gap-2"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex items-center gap-2 rounded-[6px] border border-edge bg-panel px-3 py-2 text-left text-[13px] text-primary shadow-lg transition-opacity duration-150"
        >
          {ICONS[t.kind]}
          <span className="min-w-0 break-words">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
