import { toast } from '../ui/Toasts'
import { useDocStore, type DocSnapshot } from './doc'

/**
 * Autosave to localStorage on every meaningful change (debounced) plus a slow
 * interval, restore silently on reload (§5.1). Documents are plain JSON.
 */

const DOC_KEY = 'chemcanvas:doc:v1'
let timer: ReturnType<typeof setTimeout> | null = null
let started = false

function snapshot(): DocSnapshot {
  const s = useDocStore.getState()
  return { molecules: s.molecules, reactions: s.reactions, labels: s.labels, brackets: s.brackets }
}

function save() {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(snapshot()))
  } catch {
    /* quota/private mode — autosave silently unavailable */
  }
}

/** Restore a previous session (call once, before subscribing). */
export function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(DOC_KEY)
    if (!raw) return false
    const doc = JSON.parse(raw) as DocSnapshot
    if (!doc.molecules || doc.molecules.length + (doc.labels?.length ?? 0) + (doc.reactions?.length ?? 0) === 0) {
      return false
    }
    useDocStore.getState().replaceDoc({
      molecules: doc.molecules ?? [],
      reactions: doc.reactions ?? [],
      labels: doc.labels ?? [],
      brackets: doc.brackets ?? [],
    })
    // Restoring is not an undoable action
    useDocStore.temporal.getState().clear()
    toast('Restored your last session.', 'info')
    return true
  } catch {
    return false
  }
}

/** Begin autosaving: debounce every change, plus a 20 s safety interval. */
export function startAutosave() {
  if (started) return
  started = true
  useDocStore.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 800)
  })
  setInterval(save, 20000)
  window.addEventListener('beforeunload', save)
}
