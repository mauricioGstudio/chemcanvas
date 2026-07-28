import { create } from 'zustand'
import type { ValenceIssue } from '../chem/valence'

/**
 * Derived chemistry warnings (valence dots). Not part of the document or its
 * history — recomputed by docActions after every structural mutation.
 */
interface ChemIssuesState {
  /** atomId → human explanation */
  issues: ReadonlyMap<string, string>
  setIssuesForMolecules: (byMol: Record<string, ValenceIssue[]>) => void
  replaceAll: (issues: ValenceIssue[]) => void
}

export const useChemIssues = create<ChemIssuesState>((set) => ({
  issues: new Map(),
  setIssuesForMolecules: () => {},
  replaceAll: (list) => set({ issues: new Map(list.map((i) => [i.atomId, i.message])) }),
}))
