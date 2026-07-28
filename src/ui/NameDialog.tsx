import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Identification } from '../chem/identify'
import { useIdentifyStore } from '../state/identify'

/**
 * Result surface for structure → name lookup (§7.6, the reverse of
 * Text-to-Molecule). Says plainly where a name came from and how well it
 * matched, and says "not found" rather than inventing a name.
 */

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <div className="py-1.5">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="flex items-start justify-between gap-2">
        <span
          className={
            big
              ? 'text-[19px] leading-snug font-medium text-primary'
              : 'text-[13px] leading-snug break-words text-secondary'
          }
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setDone(true)
              setTimeout(() => setDone(false), 1200)
            })
          }}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:bg-hover hover:text-primary"
        >
          {done ? <Check size={11} className="text-success" /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  )
}

function Body({ result }: { result: Identification }) {
  const { status } = result

  if (status === 'invalid') {
    return (
      <p className="text-[13px] leading-relaxed text-secondary">
        This structure can't be read as valid chemistry yet. Fix the flagged valence issues and
        try again.
      </p>
    )
  }
  if (status === 'busy') {
    return (
      <p className="text-[13px] leading-relaxed text-secondary">
        PubChem is rate-limiting requests right now. Wait a moment and try again — the structure
        itself is fine.
      </p>
    )
  }
  if (status === 'network') {
    return (
      <p className="text-[13px] leading-relaxed text-secondary">
        Couldn't reach PubChem. Name lookup needs a connection; everything else in ChemCanvas
        works offline.
      </p>
    )
  }

  if (status === 'not-found') {
    return (
      <>
        <p className="text-[13px] leading-relaxed text-secondary">
          PubChem doesn't hold this structure, so it has no established name. That's the expected
          answer for a novel compound.
        </p>
        <p className="pt-2 text-[12px] leading-relaxed text-muted">
          Naming it properly means deriving IUPAC nomenclature, which no offline tool here can do.
          Until then these identifiers describe it exactly:
        </p>
        <div className="mt-1 border-t border-edge pt-1">
          {result.smiles && <CopyRow label="SMILES" value={result.smiles} />}
          {result.inchiKey && <CopyRow label="InChIKey" value={result.inchiKey} />}
        </div>
      </>
    )
  }

  // exact | connectivity
  const name = result.title ?? result.iupacName ?? '—'
  return (
    <>
      {status === 'connectivity' && (
        <div className="mb-2 rounded-[6px] border border-edge bg-toolbar px-2.5 py-1.5 text-[12px] leading-relaxed text-warning">
          Skeleton match only — PubChem knows this connectivity, but its stereochemistry may
          differ from what you drew.
        </div>
      )}

      <CopyRow label={status === 'exact' ? 'Name' : 'Closest name'} value={name} big />

      {result.iupacName && result.iupacName !== name && (
        <CopyRow label="IUPAC name" value={result.iupacName} />
      )}

      {result.formula && (
        <div className="py-1.5">
          <div className="text-[11px] tracking-wide text-muted uppercase">Formula</div>
          <span className="font-mono text-[13px] text-secondary">{result.formula}</span>
        </div>
      )}

      {result.synonyms && result.synonyms.length > 0 && (
        <div className="py-1.5">
          <div className="pb-1 text-[11px] tracking-wide text-muted uppercase">Also known as</div>
          <div className="flex flex-wrap gap-1">
            {result.synonyms.map((s) => (
              <span
                key={s}
                className="rounded-[4px] border border-edge px-1.5 py-0.5 text-[11px] text-secondary"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {result.cid !== undefined && (
        <a
          href={`https://pubchem.ncbi.nlm.nih.gov/compound/${result.cid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-[6px] border border-edge bg-toolbar py-1.5 text-[12px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
        >
          <ExternalLink size={12} /> PubChem CID {result.cid}
        </a>
      )}
    </>
  )
}

export default function NameDialog() {
  const open = useIdentifyStore((s) => s.open)
  const loading = useIdentifyStore((s) => s.loading)
  const subject = useIdentifyStore((s) => s.subject)
  const result = useIdentifyStore((s) => s.result)
  const close = useIdentifyStore((s) => s.close)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={close}>
      <div
        className="max-h-[80vh] w-[340px] overflow-y-auto rounded-[10px] border border-edge-strong bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Structure name"
      >
        <div className="flex items-center justify-between pb-2">
          <span className="text-[15px] font-medium text-primary">Name this structure</span>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-primary"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <p className="py-2 text-[13px] text-muted">
            Looking up {subject ?? 'structure'} in PubChem…
          </p>
        ) : result ? (
          <Body result={result} />
        ) : null}

        <p className="mt-3 border-t border-edge pt-2 text-[11px] leading-relaxed text-muted">
          Names are looked up in PubChem by exact structure, not generated locally.
        </p>
      </div>
    </div>
  )
}
