import { openDirection, type Pt } from '../canvas/geometry'
import { implicitHsForMolblock, molblockFromSmiles } from '../chem/properties'
import { getRDKit } from '../chem/rdkit'
import { refreshMoleculeChemistry, type ValenceIssue } from '../chem/valence'
import { abbreviationByLabel } from '../model/abbreviations'
import { BOND_LENGTH, moleculeFromMolblock, moleculeToMolblock, newId } from '../model/graph'
import type { Atom, Bond, BondOrder, BondStereo, Bracket, Molecule, Reaction } from '../model/types'
import { useChemIssues } from './chemIssues'
import { useDocStore } from './doc'
import { useEditorStore } from './editor'

/**
 * Structural document mutations. Every exported function performs exactly ONE
 * doc-store write (one undo step) and refreshes derived chemistry (implicit H
 * on atoms, valence warnings in the issues store) for the molecules it touched.
 */

function commit(molecules: Molecule[]) {
  const refreshed: Molecule[] = []
  const issues: ValenceIssue[] = []
  for (const m of molecules) {
    if (m.atoms.length === 0) continue
    const r = refreshMoleculeChemistry(m)
    refreshed.push(r.molecule)
    issues.push(...r.issues)
  }
  useDocStore.setState({ molecules: refreshed })
  useChemIssues.getState().replaceAll(issues)
}

function mols(): Molecule[] {
  return useDocStore.getState().molecules
}

export function findAtom(atomId: string): { mol: Molecule; atom: Atom } | null {
  for (const m of mols()) {
    const a = m.atoms.find((x) => x.id === atomId)
    if (a) return { mol: m, atom: a }
  }
  return null
}

export function findBond(bondId: string): { mol: Molecule; bond: Bond } | null {
  for (const m of mols()) {
    const b = m.bonds.find((x) => x.id === bondId)
    if (b) return { mol: m, bond: b }
  }
  return null
}

/** Place a lone atom as its own molecule. */
export function placeAtom(at: Pt, element: string) {
  const mol: Molecule = {
    id: newId('m'),
    atoms: [{ id: newId('a'), element, x: at.x, y: at.y, charge: 0 }],
    bonds: [],
  }
  commit([...mols(), mol])
}

export function setAtomElement(atomId: string, element: string) {
  commit(
    mols().map((m) =>
      m.atoms.some((a) => a.id === atomId)
        ? { ...m, atoms: m.atoms.map((a) => (a.id === atomId ? { ...a, element } : a)) }
        : m,
    ),
  )
}

export function updateAtom(atomId: string, patch: Partial<Atom>) {
  commit(
    mols().map((m) =>
      m.atoms.some((a) => a.id === atomId)
        ? { ...m, atoms: m.atoms.map((a) => (a.id === atomId ? { ...a, ...patch } : a)) }
        : m,
    ),
  )
}

/**
 * Draw a bond starting at an existing atom.
 * end: empty point → creates a new atom there; existing atom → connects
 * (merging molecules when needed). Duplicate bonds update order instead.
 */
export function addBond(
  fromAtomId: string,
  end: Pt | { atomId: string },
  order: BondOrder,
  stereo: BondStereo,
  newElement = 'C',
) {
  const from = findAtom(fromAtomId)
  if (!from) return
  const all = mols()

  if ('atomId' in end) {
    if (end.atomId === fromAtomId) return
    const to = findAtom(end.atomId)
    if (!to) return
    if (from.mol.id === to.mol.id) {
      const existing = from.mol.bonds.find(
        (b) =>
          (b.a1 === fromAtomId && b.a2 === end.atomId) ||
          (b.a2 === fromAtomId && b.a1 === end.atomId),
      )
      const next = all.map((m) => {
        if (m.id !== from.mol.id) return m
        if (existing) {
          return {
            ...m,
            bonds: m.bonds.map((b) => (b.id === existing.id ? { ...b, order, stereo } : b)),
          }
        }
        return {
          ...m,
          bonds: [...m.bonds, { id: newId('b'), a1: fromAtomId, a2: end.atomId, order, stereo }],
        }
      })
      commit(next)
    } else {
      // Merge the two molecules with the new bond
      const merged: Molecule = {
        id: from.mol.id,
        atoms: [...from.mol.atoms, ...to.mol.atoms],
        bonds: [
          ...from.mol.bonds,
          ...to.mol.bonds,
          { id: newId('b'), a1: fromAtomId, a2: end.atomId, order, stereo },
        ],
      }
      commit(all.filter((m) => m.id !== from.mol.id && m.id !== to.mol.id).concat(merged))
    }
    return
  }

  const atom: Atom = { id: newId('a'), element: newElement, x: end.x, y: end.y, charge: 0 }
  const next = all.map((m) =>
    m.id === from.mol.id
      ? {
          ...m,
          atoms: [...m.atoms, atom],
          bonds: [...m.bonds, { id: newId('b'), a1: fromAtomId, a2: atom.id, order, stereo }],
        }
      : m,
  )
  commit(next)
}

/** Predictive growth: click an atom with the bond tool → extend in the most open direction. */
export function growBond(atomId: string, order: BondOrder, stereo: BondStereo, element = 'C') {
  const found = findAtom(atomId)
  if (!found) return
  const angle = openDirection(found.mol, atomId)
  addBond(
    atomId,
    {
      x: found.atom.x + Math.cos(angle) * BOND_LENGTH,
      y: found.atom.y + Math.sin(angle) * BOND_LENGTH,
    },
    order,
    stereo,
    element,
  )
}

export function setBondOrder(bondId: string, order: BondOrder) {
  commit(
    mols().map((m) =>
      m.bonds.some((b) => b.id === bondId)
        ? {
            ...m,
            bonds: m.bonds.map((b) => (b.id === bondId ? { ...b, order, stereo: 'none' as BondStereo } : b)),
          }
        : m,
    ),
  )
}

/** Apply a stereo mark; if the bond already has it, flip its direction instead. */
export function setBondStereo(bondId: string, stereo: BondStereo) {
  commit(
    mols().map((m) => {
      const bond = m.bonds.find((b) => b.id === bondId)
      if (!bond) return m
      return {
        ...m,
        bonds: m.bonds.map((b) => {
          if (b.id !== bondId) return b
          if (b.stereo === stereo && (stereo === 'wedge' || stereo === 'dash')) {
            return { ...b, a1: b.a2, a2: b.a1 } // flip narrow end
          }
          return { ...b, stereo }
        }),
      }
    }),
  )
}

export function cycleBondOrder(bondId: string) {
  const found = findBond(bondId)
  if (!found) return
  const order: BondOrder = found.bond.order === 1 ? 2 : found.bond.order === 2 ? 3 : 1
  setBondOrder(bondId, order)
}

/** Split a molecule into connected components after deletions. */
function components(mol: Molecule): Molecule[] {
  if (mol.atoms.length === 0) return []
  const adj = new Map<string, string[]>()
  for (const b of mol.bonds) {
    ;(adj.get(b.a1) ?? adj.set(b.a1, []).get(b.a1)!).push(b.a2)
    ;(adj.get(b.a2) ?? adj.set(b.a2, []).get(b.a2)!).push(b.a1)
  }
  const seen = new Set<string>()
  const groups: Set<string>[] = []
  for (const a of mol.atoms) {
    if (seen.has(a.id)) continue
    const group = new Set<string>()
    const stack = [a.id]
    while (stack.length) {
      const id = stack.pop()!
      if (group.has(id)) continue
      group.add(id)
      seen.add(id)
      for (const n of adj.get(id) ?? []) if (!group.has(n)) stack.push(n)
    }
    groups.push(group)
  }
  if (groups.length === 1) return [mol]
  return groups.map((g, i) => ({
    id: i === 0 ? mol.id : newId('m'),
    atoms: mol.atoms.filter((a) => g.has(a.id)),
    bonds: mol.bonds.filter((b) => g.has(b.a1) && g.has(b.a2)),
  }))
}

/** Delete atoms (with incident bonds) and bonds; re-partition into connected structures. */
export function deleteItems(atomIds: ReadonlySet<string>, bondIds: ReadonlySet<string>) {
  if (atomIds.size === 0 && bondIds.size === 0) return
  const next: Molecule[] = []
  for (const m of mols()) {
    const touched =
      m.atoms.some((a) => atomIds.has(a.id)) || m.bonds.some((b) => bondIds.has(b.id))
    if (!touched) {
      next.push(m)
      continue
    }
    const kept: Molecule = {
      ...m,
      atoms: m.atoms.filter((a) => !atomIds.has(a.id)),
      bonds: m.bonds.filter(
        (b) => !bondIds.has(b.id) && !atomIds.has(b.a1) && !atomIds.has(b.a2),
      ),
    }
    next.push(...components(kept))
  }
  useEditorStore.getState().clearSelection()
  commit(next)
}

/** Move a set of atoms by (dx, dy) — geometry only, single undo step. */
export function moveAtoms(atomIds: ReadonlySet<string>, dx: number, dy: number) {
  if (atomIds.size === 0 || (dx === 0 && dy === 0)) return
  useDocStore.setState({
    molecules: mols().map((m) =>
      m.atoms.some((a) => atomIds.has(a.id))
        ? {
            ...m,
            atoms: m.atoms.map((a) => (atomIds.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a)),
          }
        : m,
    ),
  })
}

/**
 * Insert a prebuilt molecule (ring template, pasted fragment), snap-merging
 * any of its atoms that land within `mergeDist` of existing atoms — this is
 * what fuses a dropped ring onto an existing structure.
 */
export function placeMolecule(mol: Molecule, mergeDist = 14) {
  const all = mols()
  type MergeTarget = { molId: string; atomId: string }
  const merges = new Map<string, MergeTarget>() // new atom id → existing atom
  for (const na of mol.atoms) {
    let best: { t: MergeTarget; d: number } | null = null
    for (const m of all) {
      for (const a of m.atoms) {
        const d = Math.hypot(a.x - na.x, a.y - na.y)
        if (d <= mergeDist && (!best || d < best.d)) best = { t: { molId: m.id, atomId: a.id }, d }
      }
    }
    if (best) merges.set(na.id, best.t)
  }

  if (merges.size === 0) {
    commit([...all, mol])
    return
  }

  // Union all involved molecules + the template into one
  const involvedIds = new Set([...merges.values()].map((t) => t.molId))
  const involved = all.filter((m) => involvedIds.has(m.id))
  const rest = all.filter((m) => !involvedIds.has(m.id))

  const atomMap = new Map<string, string>() // template atom id → final id
  for (const [naId, target] of merges) atomMap.set(naId, target.atomId)

  const mergedAtoms: Atom[] = involved.flatMap((m) => m.atoms)
  const newAtoms: Atom[] = mol.atoms.filter((a) => !merges.has(a.id))
  const mergedBonds: Bond[] = involved.flatMap((m) => m.bonds)

  const finalAtomId = (id: string) => atomMap.get(id) ?? id
  const bondKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const existingPairs = new Set(mergedBonds.map((b) => bondKey(b.a1, b.a2)))
  const newBonds: Bond[] = []
  for (const b of mol.bonds) {
    const a1 = finalAtomId(b.a1)
    const a2 = finalAtomId(b.a2)
    if (a1 === a2) continue
    if (existingPairs.has(bondKey(a1, a2))) continue // keep the existing bond on fusion edges
    existingPairs.add(bondKey(a1, a2))
    newBonds.push({ ...b, a1, a2 })
  }

  const merged: Molecule = {
    id: involved[0]?.id ?? mol.id,
    atoms: [...mergedAtoms, ...newAtoms],
    bonds: [...mergedBonds, ...newBonds],
  }
  commit([...rest, merged])
}

/** Add an n-carbon zig-zag chain; `fromAtomId` grafts onto an existing atom. */
export function addChain(points: Pt[], fromAtomId: string | null) {
  if (points.length === 0) return
  const all = mols()
  const atoms: Atom[] = points.map((p) => ({ id: newId('a'), element: 'C', x: p.x, y: p.y, charge: 0 }))
  const bonds: Bond[] = []
  for (let i = 0; i < atoms.length - 1; i++) {
    bonds.push({ id: newId('b'), a1: atoms[i].id, a2: atoms[i + 1].id, order: 1, stereo: 'none' })
  }

  if (fromAtomId) {
    const from = findAtom(fromAtomId)
    if (!from) return
    const next = all.map((m) =>
      m.id === from.mol.id
        ? {
            ...m,
            atoms: [...m.atoms, ...atoms],
            bonds: [
              ...m.bonds,
              { id: newId('b'), a1: fromAtomId, a2: atoms[0].id, order: 1 as BondOrder, stereo: 'none' as BondStereo },
              ...bonds,
            ],
          }
        : m,
    )
    commit(next)
  } else {
    commit([...all, { id: newId('m'), atoms, bonds }])
  }
}

/** Two fresh atoms + one bond as a new molecule (drag on empty canvas). */
export function addFreeBond(p1: Pt, p2: Pt, order: BondOrder, stereo: BondStereo, element = 'C') {
  const a1: Atom = { id: newId('a'), element, x: p1.x, y: p1.y, charge: 0 }
  const a2: Atom = { id: newId('a'), element, x: p2.x, y: p2.y, charge: 0 }
  commit([
    ...mols(),
    {
      id: newId('m'),
      atoms: [a1, a2],
      bonds: [{ id: newId('b'), a1: a1.id, a2: a2.id, order, stereo }],
    },
  ])
}

/** Free-text labels (no chemistry refresh needed). */
export function addLabel(at: Pt, text: string, fontSize = 14) {
  useDocStore.setState((s) => ({
    labels: [...s.labels, { id: newId('t'), x: at.x, y: at.y, text, fontSize }],
  }))
}

export function updateLabel(id: string, text: string) {
  useDocStore.setState((s) => ({
    labels: text.trim()
      ? s.labels.map((l) => (l.id === id ? { ...l, text } : l))
      : s.labels.filter((l) => l.id !== id),
  }))
}

export function deleteLabel(id: string) {
  useDocStore.setState((s) => ({ labels: s.labels.filter((l) => l.id !== id) }))
}

/** Cycle formal charge 0 → +1 → +2 → −1 → −2 → 0 (§7.1). */
export function cycleAtomCharge(atomId: string) {
  const found = findAtom(atomId)
  if (!found) return
  const seq = [0, 1, 2, -1, -2]
  const next = seq[(seq.indexOf(found.atom.charge) + 1) % seq.length]
  updateAtom(atomId, { charge: next })
}

/**
 * Re-render a molecule from an edited SMILES string, keeping its centroid.
 * Returns false when the SMILES is invalid (caller shows the error state).
 */
export function replaceMoleculeFromSmiles(molId: string, smiles: string): boolean {
  const target = mols().find((m) => m.id === molId)
  if (!target) return false
  const mb = molblockFromSmiles(smiles)
  if (!mb) return false
  const cx = target.atoms.reduce((s, a) => s + a.x, 0) / (target.atoms.length || 1)
  const cy = target.atoms.reduce((s, a) => s + a.y, 0) / (target.atoms.length || 1)
  const fresh = moleculeFromMolblock(mb, { x: cx, y: cy }, implicitHsForMolblock(mb))
  useEditorStore.getState().clearSelection()
  commit(mols().map((m) => (m.id === molId ? { ...fresh, id: m.id } : m)))
  return true
}

/**
 * Clean Up (⌘L): regenerate ideal 2D coordinates via RDKit for the given
 * molecules (default: all), preserving each molecule's centroid.
 */
export function cleanUpMolecules(molIds?: ReadonlySet<string>): number {
  const targets = mols().filter((m) => (molIds ? molIds.has(m.id) : true) && m.atoms.length > 1)
  if (targets.length === 0) return 0
  let cleaned = 0
  const replaced = new Map<string, Molecule>()
  for (const m of targets) {
    try {
      const mb = moleculeToMolblock(m)
      const RDKit = getRDKit()
      const mol = RDKit.get_mol(mb)
      if (!mol) continue
      let out: string
      try {
        mol.set_new_coords(true) // CoordGen; already uniform — see molblockFromSmiles
        out = mol.get_molblock()
      } finally {
        mol.delete()
      }
      const cx = m.atoms.reduce((s, a) => s + a.x, 0) / m.atoms.length
      const cy = m.atoms.reduce((s, a) => s + a.y, 0) / m.atoms.length
      const fresh = moleculeFromMolblock(out, { x: cx, y: cy }, implicitHsForMolblock(out))
      replaced.set(m.id, { ...fresh, id: m.id })
      cleaned++
    } catch {
      /* leave this molecule untouched */
    }
  }
  if (cleaned > 0) {
    useEditorStore.getState().clearSelection()
    commit(mols().map((m) => replaced.get(m.id) ?? m))
  }
  return cleaned
}

// ---------- Reactions, brackets, abbreviations, projections (Phase 7) ----------

export function addReaction(r: Omit<Reaction, 'id' | 'fromIds' | 'toIds'>) {
  useDocStore.setState((s) => ({
    reactions: [...s.reactions, { ...r, id: newId('r'), fromIds: [], toIds: [] }],
  }))
}

export function updateReaction(id: string, patch: Partial<Reaction>) {
  useDocStore.setState((s) => ({
    reactions: s.reactions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
}

export function deleteReaction(id: string) {
  useDocStore.setState((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) }))
}

export function addBracket(b: Omit<Bracket, 'id'>) {
  useDocStore.setState((s) => ({ brackets: [...s.brackets, { ...b, id: newId('k') }] }))
}

export function updateBracket(id: string, patch: Partial<Bracket>) {
  useDocStore.setState((s) => ({
    brackets: s.brackets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }))
}

export function deleteBracket(id: string) {
  useDocStore.setState((s) => ({ brackets: s.brackets.filter((b) => b.id !== id) }))
}

/** Wrap the current selection (or a molecule) in brackets with a subscript. */
export function bracketSelection(style: Bracket['style'] = 'square', label = 'n'): boolean {
  const sel = useEditorStore.getState().selection
  const pts: { x: number; y: number }[] = []
  for (const m of mols()) {
    for (const a of m.atoms) {
      if (sel.atomIds.has(a.id)) pts.push(a)
    }
  }
  if (pts.length === 0) return false
  const minX = Math.min(...pts.map((p) => p.x)) - 24
  const maxX = Math.max(...pts.map((p) => p.x)) + 24
  const minY = Math.min(...pts.map((p) => p.y)) - 26
  const maxY = Math.max(...pts.map((p) => p.y)) + 26
  addBracket({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, style, label })
  return true
}

/** Show an atom as a compact superatom label (display-level, expandable). */
export function setAbbreviation(atomId: string, label: string | undefined) {
  updateAtom(atomId, { abbreviation: label })
}

/**
 * Expand an abbreviated superatom into its real fragment (RDKit-built),
 * grafted onto the abbreviated atom's neighbor.
 */
export function expandAbbreviation(atomId: string): boolean {
  const found = findAtom(atomId)
  if (!found || !found.atom.abbreviation) return false
  const abbr = abbreviationByLabel(found.atom.abbreviation)
  if (!abbr) return false
  const mb = molblockFromSmiles(abbr.smiles)
  if (!mb) return false

  const { mol, atom } = found
  const neighborIds = mol.bonds
    .filter((b) => b.a1 === atomId || b.a2 === atomId)
    .map((b) => (b.a1 === atomId ? b.a2 : b.a1))
  if (neighborIds.length > 1) return false // only terminal superatoms expand
  const neighbor = mol.atoms.find((a) => a.id === neighborIds[0])

  const frag = moleculeFromMolblock(mb, { x: atom.x, y: atom.y }, implicitHsForMolblock(mb))
  // Attachment = first atom of the SMILES (parse order is preserved)
  const attach = frag.atoms[0]
  // Translate the fragment so its attachment atom sits exactly on the old atom
  const dx = atom.x - attach.x
  const dy = atom.y - attach.y
  let fatoms = frag.atoms.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }))
  // Rotate the fragment away from the neighbor
  if (neighbor) {
    const want = Math.atan2(atom.y - neighbor.y, atom.x - neighbor.x)
    const cent = {
      x: fatoms.reduce((s, a) => s + a.x, 0) / fatoms.length,
      y: fatoms.reduce((s, a) => s + a.y, 0) / fatoms.length,
    }
    const have = Math.atan2(cent.y - atom.y, cent.x - atom.x)
    const rot = fatoms.length > 1 && Number.isFinite(have) ? want - have : 0
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    fatoms = fatoms.map((a) => {
      const rx = a.x - atom.x
      const ry = a.y - atom.y
      return { ...a, x: atom.x + rx * cos - ry * sin, y: atom.y + rx * sin + ry * cos }
    })
  }

  const oldBond = mol.bonds.find((b) => b.a1 === atomId || b.a2 === atomId)
  const next = mols().map((m) => {
    if (m.id !== mol.id) return m
    const atoms = [...m.atoms.filter((a) => a.id !== atomId), ...fatoms]
    const bonds = [
      ...m.bonds.filter((b) => b.a1 !== atomId && b.a2 !== atomId),
      ...frag.bonds,
      ...(neighbor
        ? [
            {
              id: newId('b'),
              a1: neighbor.id,
              a2: attach.id,
              order: oldBond?.order ?? (1 as BondOrder),
              stereo: 'none' as BondStereo,
            },
          ]
        : []),
    ]
    return { ...m, atoms, bonds }
  })
  useEditorStore.getState().clearSelection()
  commit(next)
  return true
}

/** Invert a stereocenter: swap wedge ↔ dash on its stereo bonds. */
export function invertStereocenter(atomId: string): boolean {
  let flipped = false
  const next = mols().map((m) => {
    if (!m.atoms.some((a) => a.id === atomId)) return m
    return {
      ...m,
      bonds: m.bonds.map((b) => {
        if (b.a1 !== atomId || (b.stereo !== 'wedge' && b.stereo !== 'dash')) return b
        flipped = true
        return { ...b, stereo: b.stereo === 'wedge' ? ('dash' as BondStereo) : ('wedge' as BondStereo) }
      }),
    }
  })
  if (flipped) commit(next)
  return flipped
}

/**
 * One-click reaction auto-layout (§7.6): reactants → arrow → products in a
 * horizontal row with even spacing, plus signs between structures.
 */
export function autoLayoutReaction(): boolean {
  const doc = useDocStore.getState()
  const arrow = [...doc.reactions].filter((r) => r.kind !== 'curly').sort((a, b) => a.x - b.x)[0]
  if (!arrow || doc.molecules.length === 0) return false

  const GAP = 56
  const boxes = doc.molecules
    .map((m) => {
      const xs = m.atoms.map((a) => a.x)
      const ys = m.atoms.map((a) => a.y)
      return {
        mol: m,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      }
    })
    .sort((a, b) => a.cx - b.cx)

  const arrowCx = arrow.x + (arrow.length / 2) * Math.cos(arrow.angle ?? 0)
  const reactants = boxes.filter((b) => b.cx < arrowCx)
  const products = boxes.filter((b) => b.cx >= arrowCx)
  const arrowLen = Math.max(arrow.length, 90)

  const widths = boxes.map((b) => b.maxX - b.minX)
  const plusCount = Math.max(0, reactants.length - 1) + Math.max(0, products.length - 1)
  const total =
    widths.reduce((s, w) => s + w, 0) + arrowLen + GAP * (boxes.length + 1) + plusCount * 18
  const rowCy = arrow.y
  let x = arrowCx - total / 2

  const moved = new Map<string, { dx: number; dy: number }>()
  const plusLabels: { x: number; y: number }[] = []
  const placeRow = (row: typeof boxes) => {
    row.forEach((b, i) => {
      if (i > 0) {
        plusLabels.push({ x: x + 6, y: rowCy })
        x += 18 + GAP
      }
      moved.set(b.mol.id, { dx: x - b.minX, dy: rowCy - b.cy })
      x += b.maxX - b.minX + GAP
    })
  }
  placeRow(reactants)
  const arrowX = x
  x += arrowLen + GAP
  placeRow(products)

  useDocStore.setState((s) => ({
    molecules: s.molecules.map((m) => {
      const d = moved.get(m.id)
      if (!d) return m
      return { ...m, atoms: m.atoms.map((a) => ({ ...a, x: a.x + d.dx, y: a.y + d.dy })) }
    }),
    reactions: s.reactions.map((r) =>
      r.id === arrow.id ? { ...r, x: arrowX, y: rowCy, length: arrowLen, angle: 0 } : r,
    ),
    labels: [
      ...s.labels.filter((l) => l.text !== '+'),
      ...plusLabels.map((p) => ({ id: newId('t'), x: p.x, y: p.y + 5, text: '+', fontSize: 16 })),
    ],
  }))
  return true
}

/**
 * Fischer-style re-layout (§7.5): main chain vertical, substituents horizontal.
 * Geometry-only transform for acyclic molecules; stereo marks are preserved.
 */
export function fischerLayout(molId: string): boolean {
  const mol = mols().find((m) => m.id === molId)
  if (!mol || mol.atoms.length < 3) return false
  const adj = new Map<string, string[]>()
  for (const b of mol.bonds) {
    ;(adj.get(b.a1) ?? adj.set(b.a1, []).get(b.a1)!).push(b.a2)
    ;(adj.get(b.a2) ?? adj.set(b.a2, []).get(b.a2)!).push(b.a1)
  }
  if (mol.bonds.length !== mol.atoms.length - 1) return false // rings → not a Fischer chain

  // Longest path (small graphs: BFS farthest twice)
  const far = (start: string) => {
    const dist = new Map<string, number>([[start, 0]])
    const prev = new Map<string, string>()
    const q = [start]
    let last = start
    while (q.length) {
      const v = q.shift()!
      last = v
      for (const n of adj.get(v) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, dist.get(v)! + 1)
          prev.set(n, v)
          q.push(n)
        }
      }
    }
    return { last, prev }
  }
  const a = far(mol.atoms[0].id)
  const b = far(a.last)
  const path: string[] = []
  for (let v: string | undefined = b.last; v !== undefined; v = b.prev.get(v)) path.push(v)

  const cx = mol.atoms.reduce((s, at) => s + at.x, 0) / mol.atoms.length
  const topY = mol.atoms.reduce((s, at) => s + at.y, 0) / mol.atoms.length - ((path.length - 1) * BOND_LENGTH) / 2
  const pos = new Map<string, { x: number; y: number }>()
  path.forEach((id, i) => pos.set(id, { x: cx, y: topY + i * BOND_LENGTH }))

  const onPath = new Set(path)
  // First-level substituents alternate right/left; deeper atoms extend outward
  for (const id of path) {
    const subs = (adj.get(id) ?? []).filter((n) => !onPath.has(n) && !pos.has(n))
    subs.forEach((sub, i) => {
      const side = i % 2 === 0 ? 1 : -1
      const base = pos.get(id)!
      pos.set(sub, { x: base.x + side * BOND_LENGTH, y: base.y })
      // extend that substituent's subtree horizontally
      const stack = [{ id: sub, depth: 1 }]
      const seen = new Set([id, sub])
      while (stack.length) {
        const cur = stack.pop()!
        for (const n of adj.get(cur.id) ?? []) {
          if (seen.has(n) || pos.has(n)) continue
          seen.add(n)
          pos.set(n, { x: base.x + side * BOND_LENGTH * (cur.depth + 1), y: base.y })
          stack.push({ id: n, depth: cur.depth + 1 })
        }
      }
    })
  }

  commit(
    mols().map((m) =>
      m.id === molId
        ? { ...m, atoms: m.atoms.map((at) => ({ ...at, ...(pos.get(at.id) ?? {}) })) }
        : m,
    ),
  )
  return true
}

/** Recompute chemistry for the whole document (e.g. after RDKit finishes loading). */
export function refreshAllChemistry() {
  commit(mols())
}
