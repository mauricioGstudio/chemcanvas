/**
 * Name → structure lookup. PubChem PUG REST first (best for common/brand
 * names), OPSIN as fallback for strict IUPAC nomenclature. All requests are
 * plain GETs against free, keyless services; failures degrade to friendly
 * messages, never crashes.
 */

export interface CompoundResult {
  /** Display name (autocomplete term or the query itself). */
  name: string
  source: 'pubchem' | 'opsin'
  smiles: string
  formula?: string
  mw?: number
  iupacName?: string
  cid?: number
}

export type LookupFailure = 'not-found' | 'busy' | 'network'

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov'

class LookupError extends Error {
  kind: LookupFailure
  constructor(kind: LookupFailure) {
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

/** PubChem autocomplete: up to `limit` compound-name suggestions. */
export async function pubchemAutocomplete(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${PUBCHEM}/rest/autocomplete/compound/${encodeURIComponent(query)}/json?limit=${limit}`
  const data = (await getJson(url, signal)) as {
    dictionary_terms?: { compound?: string[] }
  }
  return data.dictionary_terms?.compound ?? []
}

interface PubchemProps {
  CID: number
  SMILES?: string
  ConnectivitySMILES?: string
  CanonicalSMILES?: string
  IsomericSMILES?: string
  MolecularFormula?: string
  MolecularWeight?: string
  IUPACName?: string
}

const propCache = new Map<string, Promise<CompoundResult>>()

/** Fetch structure + metadata for one exact compound name from PubChem. */
export function pubchemByName(name: string, signal?: AbortSignal): Promise<CompoundResult> {
  const key = name.toLowerCase()
  const cached = propCache.get(key)
  if (cached) return cached

  const run = async (): Promise<CompoundResult> => {
    // Property names changed in 2025 (SMILES/ConnectivitySMILES); request both
    // generations and take whichever comes back.
    const props = 'SMILES,ConnectivitySMILES,MolecularFormula,MolecularWeight,IUPACName'
    const url = `${PUBCHEM}/rest/pug/compound/name/${encodeURIComponent(name)}/property/${props}/JSON`
    const data = (await getJson(url, signal)) as {
      PropertyTable?: { Properties?: PubchemProps[] }
    }
    const p = data.PropertyTable?.Properties?.[0]
    const smiles = p?.SMILES ?? p?.IsomericSMILES ?? p?.ConnectivitySMILES ?? p?.CanonicalSMILES
    if (!p || !smiles) throw new LookupError('not-found')
    return {
      name,
      source: 'pubchem',
      smiles,
      formula: p.MolecularFormula,
      mw: p.MolecularWeight ? parseFloat(p.MolecularWeight) : undefined,
      iupacName: p.IUPACName,
      cid: p.CID,
    }
  }

  const promise = run()
  propCache.set(key, promise)
  promise.catch(() => propCache.delete(key))
  return promise
}

/** OPSIN: strict IUPAC name → SMILES. 404 = name not parseable. */
export async function opsinByName(name: string, signal?: AbortSignal): Promise<CompoundResult> {
  let res: Response
  try {
    res = await fetch(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(name)}.smi`, {
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new LookupError('network')
  }
  if (res.status === 404) throw new LookupError('not-found')
  if (!res.ok) throw new LookupError('network')
  const smiles = (await res.text()).trim()
  if (!smiles) throw new LookupError('not-found')
  return { name, source: 'opsin', smiles }
}

export function failureKind(err: unknown): LookupFailure {
  return err instanceof LookupError ? err.kind : 'network'
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
