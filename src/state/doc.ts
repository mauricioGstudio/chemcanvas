import { create } from 'zustand'
import { temporal } from 'zundo'
import { useStore } from 'zustand'
import type { Bracket, Molecule, Reaction, TextLabel } from '../model/types'

/**
 * The document: everything that lives on the canvas and participates in
 * undo/redo. Selection, view, and tool state live in the editor store.
 */
export interface DocState {
  molecules: Molecule[]
  reactions: Reaction[]
  labels: TextLabel[]
  brackets: Bracket[]

  addMolecule: (m: Molecule) => void
  removeMolecule: (id: string) => void
  updateMolecule: (id: string, updater: (m: Molecule) => Molecule) => void
  replaceDoc: (doc: DocSnapshot) => void
  clearDoc: () => void
}

export type DocSnapshot = Pick<DocState, 'molecules' | 'reactions' | 'labels' | 'brackets'>

export const useDocStore = create<DocState>()(
  temporal(
    (set) => ({
      molecules: [],
      reactions: [],
      labels: [],
      brackets: [],

      addMolecule: (m) => set((s) => ({ molecules: [...s.molecules, m] })),
      removeMolecule: (id) => set((s) => ({ molecules: s.molecules.filter((m) => m.id !== id) })),
      updateMolecule: (id, updater) =>
        set((s) => ({ molecules: s.molecules.map((m) => (m.id === id ? updater(m) : m)) })),
      replaceDoc: (doc) => set(doc),
      clearDoc: () => set({ molecules: [], reactions: [], labels: [], brackets: [] }),
    }),
    {
      // Unlimited history; snapshot only the document data, not the actions.
      partialize: (s): DocSnapshot => ({
        molecules: s.molecules,
        reactions: s.reactions,
        labels: s.labels,
        brackets: s.brackets,
      }),
      equality: (a, b) =>
        a.molecules === b.molecules &&
        a.reactions === b.reactions &&
        a.labels === b.labels &&
        a.brackets === b.brackets,
    },
  ),
)

export const undo = () => useDocStore.temporal.getState().undo()
export const redo = () => useDocStore.temporal.getState().redo()

/** Reactive access to history depth (for enabling buttons / history panel). */
export function useHistory() {
  const past = useStore(useDocStore.temporal, (s) => s.pastStates.length)
  const future = useStore(useDocStore.temporal, (s) => s.futureStates.length)
  return { canUndo: past > 0, canRedo: future > 0, past, future }
}

// Dev-only: expose for debugging/self-tests from the browser console.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__doc = useDocStore
}
