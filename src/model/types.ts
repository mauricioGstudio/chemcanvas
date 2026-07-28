export type Element = string // "C", "N", "O", "Cl", ...

export interface Atom {
  id: string
  element: Element
  x: number
  y: number // 2D canvas coords (molblock frame)
  charge: number // formal charge
  isotope?: number
  radical?: 0 | 1 | 2
  implicitH?: number // computed by RDKit
  mapNum?: number // atom-mapping for reactions
  abbreviation?: string // superatom label e.g. "Boc"
}

export type BondOrder = 1 | 2 | 3 | 'aromatic'
export type BondStereo = 'wedge' | 'dash' | 'wavy' | 'none'

export interface Bond {
  id: string
  a1: string
  a2: string // atom ids
  order: BondOrder
  stereo?: BondStereo
}

/** One connected structure. */
export interface Molecule {
  id: string
  atoms: Atom[]
  bonds: Bond[]
}

export type ReactionKind = 'forward' | 'equilibrium' | 'resonance' | 'retro' | 'curly'

export interface Reaction {
  id: string
  kind: ReactionKind
  fromIds: string[]
  toIds: string[]
  conditionsTop?: string
  conditionsBottom?: string
  /** Arrow placement on canvas (start point). */
  x: number
  y: number
  /** Straight arrows: length along +x after `angle`. */
  length: number
  /** Rotation in radians (0 = pointing right). */
  angle?: number
  /** Curly electron-pushing arrows: explicit end point (curved path). */
  x2?: number
  y2?: number
}

export type BracketStyle = 'square' | 'round' | 'curly'

export interface Bracket {
  id: string
  x: number
  y: number
  w: number
  h: number
  style: BracketStyle
  /** Repeat-count / Markush subscript shown at the lower right. */
  label?: string
}

export interface TextLabel {
  id: string
  x: number
  y: number
  text: string
  fontSize: number
}

export type Tool =
  | 'select'
  | 'atom'
  | 'bond'
  | 'ring'
  | 'chain'
  | 'text'
  | 'eraser'
  | 'arrow'

export interface Selection {
  atomIds: Set<string>
  bondIds: Set<string>
  moleculeIds: Set<string>
  labelIds: Set<string>
  reactionIds: Set<string>
}

export const EMPTY_SELECTION: Selection = {
  atomIds: new Set(),
  bondIds: new Set(),
  moleculeIds: new Set(),
  labelIds: new Set(),
  reactionIds: new Set(),
}
