/**
 * Structure → name lookup: the reverse of the Text-to-Molecule path.
 *
 * Honest limitation baked into the design: no client-side library generates
 * IUPAC names from a structure (RDKit doesn't, and OPSIN only runs
 * name → structure). So a name can only be *recognized*, not *derived* — we
 * ask PubChem whether it already knows this exact structure.
 *
 * Two passes, most-specific first:
 *   1. InChIKey exact match — same skeleton AND same stereochemistry.
 *   2. Same-connectivity match — same skeleton, stereochemistry may differ.
 * Anything PubChem doesn't hold comes back 'not-found' and is reported as
 * such. A novel compound genuinely has no looked-up name, and inventing one
 * would be worse than saying so.
 */

import { getRDKit } from './rdkit'

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov'

export type IdentifyStatus =
  /** PubChem holds this exact structure, stereochemistry included. */
  | 'exact'
  /** PubChem holds this skeleton, but the stereochemistry may not match. */
  | 'connectivity'
  /** Structure is valid but unknown to PubChem — likely novel. */
  | 'not-found'
  /** PubChem rate-limited us. */
  | 'busy'
  | 'network'
  /** RDKit could not read the structure (usually a valence error). */
  | 'invalid'

export interface Identification {
  status: IdentifyStatus
  /** PubChem's preferred display name, e.g. "Caffeine". */
  title?: string
  iupacName?: string
  /** Other names PubChem lists, filtered down to human-readable ones. */
  synonyms?: string[]
  cid?: number
  formula?: string
  /** Identifiers computed locally — always present when the structure parses. */
  inchiKey?: string
  smiles?: string
}

class LookupError extends Error {
  kind: IdentifyStatus
  constructor(kind: IdentifyStatus) {
    super(kind)
    this.kind = kind
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new LookupError('network')
  }
  if (res.status === 404) throw new LookupError('not-found')
  if (res.status === 503 || res.status === 429) throw new LookupError('busy')
  if (!res.ok) throw new LookupError('network')
  return res.json()
}

/**
 * POST rather than GET for SMILES: strings routinely contain `/`, `\`, `#`
 * and `+`, which are fragile in a URL path even when encoded.
 */
async function postJson(url: string, body: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new LookupError('network')
  }
  if (res.status === 404) throw new LookupError('not-found')
  if (res.status === 503 || res.status === 429) throw new LookupError('busy')
  if (!res.ok) throw new LookupError('network')
  return res.json()
}

interface PubchemProps {
  CID: number
  Title?: string
  IUPACName?: string
  MolecularFormula?: string
}

/**
 * Local identifiers straight from RDKit; throws 'invalid' only if the
 * structure itself won't parse. InChI generation can fail on exotic
 * structures even when the molecule is fine — that just costs us the exact
 * pass, so it degrades to an empty key rather than failing the lookup.
 */
function localIdentifiers(molblock: string): { inchiKey: string; smiles: string } {
  let mol: ReturnType<ReturnType<typeof getRDKit>['get_mol']> | null = null
  try {
    const RDKit = getRDKit()
    mol = RDKit.get_mol(molblock)
    if (!mol) throw new LookupError('invalid')
    const smiles = mol.get_smiles()
    if (!smiles) throw new LookupError('invalid')
    let inchiKey = ''
    try {
      const inchi = mol.get_inchi()
      if (inchi) inchiKey = RDKit.get_inchikey_for_inchi(inchi)
    } catch {
      /* no InChI for this structure; the connectivity pass still works */
    }
    return { inchiKey, smiles }
  } catch (err) {
    if (err instanceof LookupError) throw err
    throw new LookupError('invalid')
  } finally {
    mol?.delete()
  }
}

const PROPS = 'Title,IUPACName,MolecularFormula'

async function propsForCid(cid: number, signal?: AbortSignal): Promise<PubchemProps | undefined> {
  const data = (await getJson(
    `${PUBCHEM}/rest/pug/compound/cid/${cid}/property/${PROPS}/JSON`,
    signal,
  )) as { PropertyTable?: { Properties?: PubchemProps[] } }
  return data.PropertyTable?.Properties?.[0]
}

/**
 * Synonyms are a long, noisy list (CAS numbers, vendor catalogue codes,
 * registry IDs). Keep only entries that read like actual names.
 */
function readableSynonyms(all: string[], exclude: string[]): string[] {
  const seen = new Set(exclude.map((s) => s.toLowerCase()))
  const out: string[] = []
  for (const s of all) {
    const t = s.trim()
    if (t.length < 3 || t.length > 40) continue
    if (/\d{2,}-\d{2}-\d/.test(t)) continue // CAS number
    if (/^[A-Z]{1,6}[- ]?\d{3,}$/i.test(t)) continue // catalogue/registry code
    if (!/[a-z]{3}/.test(t)) continue // needs real lowercase letters
    if (/^(unii|chebi|chembl|dtxsid|nsc|ec |mfcd)/i.test(t)) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= 6) break
  }
  return out
}

async function synonymsForCid(cid: number, exclude: string[], signal?: AbortSignal) {
  try {
    const data = (await getJson(
      `${PUBCHEM}/rest/pug/compound/cid/${cid}/synonyms/JSON`,
      signal,
    )) as { InformationList?: { Information?: { Synonym?: string[] }[] } }
    const list = data.InformationList?.Information?.[0]?.Synonym ?? []
    return readableSynonyms(list, exclude)
  } catch {
    return [] // synonyms are a nicety; never fail the whole lookup over them
  }
}

/** Results are cached by InChIKey — the same structure always resolves the same way. */
const cache = new Map<string, Identification>()

/**
 * Identify a structure by its molblock. Never throws: every failure mode is
 * reported through `status` so the UI can explain it plainly.
 */
export async function identifyStructure(
  molblock: string,
  signal?: AbortSignal,
): Promise<Identification> {
  let ids: { inchiKey: string; smiles: string }
  try {
    ids = localIdentifiers(molblock)
  } catch {
    return { status: 'invalid' }
  }

  const cached = ids.inchiKey ? cache.get(ids.inchiKey) : undefined
  if (cached) return cached

  const base = { inchiKey: ids.inchiKey, smiles: ids.smiles }

  const finish = async (
    status: 'exact' | 'connectivity',
    p: PubchemProps,
  ): Promise<Identification> => {
    const names = [p.Title, p.IUPACName].filter(Boolean) as string[]
    const synonyms = await synonymsForCid(p.CID, names, signal)
    const result: Identification = {
      ...base,
      status,
      title: p.Title,
      iupacName: p.IUPACName,
      formula: p.MolecularFormula,
      cid: p.CID,
      synonyms,
    }
    if (ids.inchiKey) cache.set(ids.inchiKey, result)
    return result
  }

  // Pass 1 — exact structure, stereochemistry included.
  if (ids.inchiKey) {
    try {
      const data = (await getJson(
        `${PUBCHEM}/rest/pug/compound/inchikey/${encodeURIComponent(ids.inchiKey)}/property/${PROPS}/JSON`,
        signal,
      )) as { PropertyTable?: { Properties?: PubchemProps[] } }
      const p = data.PropertyTable?.Properties?.[0]
      if (p) return finish('exact', p)
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      const kind = err instanceof LookupError ? err.kind : 'network'
      // Only a clean 404 is worth a second pass; busy/network should surface.
      if (kind !== 'not-found') return { ...base, status: kind }
    }
  }

  // Pass 2 — same connectivity, stereochemistry may differ.
  try {
    const data = (await postJson(
      `${PUBCHEM}/rest/pug/compound/fastidentity/smiles/cids/JSON?identity_type=same_connectivity`,
      `smiles=${encodeURIComponent(ids.smiles)}`,
      signal,
    )) as { IdentifierList?: { CID?: number[] } }
    const cid = data.IdentifierList?.CID?.[0]
    if (cid) {
      const p = await propsForCid(cid, signal)
      if (p) return finish('connectivity', p)
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const kind = err instanceof LookupError ? err.kind : 'network'
    if (kind !== 'not-found') return { ...base, status: kind }
  }

  const miss: Identification = { ...base, status: 'not-found' }
  if (ids.inchiKey) cache.set(ids.inchiKey, miss)
  return miss
}
