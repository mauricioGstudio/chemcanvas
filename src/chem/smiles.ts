import { validateSmiles } from './properties'
import { isRDKitReady } from './rdkit'

/**
 * Heuristic: does this input look like a SMILES string rather than a name?
 * Names may contain spaces; SMILES never do. Strong SMILES signals: brackets,
 * bond symbols, ring-closure digits, branch parens.
 */
export function looksLikeSmiles(q: string): boolean {
  const s = q.trim()
  if (!s || /\s/.test(s)) return false
  if (!/^[A-Za-z0-9@+\-[\]()=#$%/\\.:*]+$/.test(s)) return false
  return /[[\]=#$/\\]|[A-Za-z]\d|\([A-Za-z(]|^[cnosp]\d/.test(s)
}

export interface SmilesCheck {
  isSmiles: boolean
  valid: boolean
  formulaText?: string
}

/** Live validation for the palette: intent + RDKit validity + formula preview. */
export function checkSmiles(q: string): SmilesCheck {
  if (!looksLikeSmiles(q) || !isRDKitReady()) return { isSmiles: false, valid: false }
  const res = validateSmiles(q.trim())
  return { isSmiles: res.valid, valid: res.valid, formulaText: res.formulaText }
}
