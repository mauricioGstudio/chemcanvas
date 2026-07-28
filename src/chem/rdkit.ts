import type { RDKitModule } from '@rdkit/rdkit'

/**
 * Singleton loader for the RDKit WASM module.
 * The module script (/RDKit_minimal.js) is loaded from index.html and exposes
 * window.initRDKitModule (typed globally by @rdkit/rdkit); the .wasm lives
 * alongside it in /public.
 */
let instance: RDKitModule | null = null
let loading: Promise<RDKitModule> | null = null

export function initRDKit(): Promise<RDKitModule> {
  if (loading) return loading
  loading = window
    .initRDKitModule({ locateFile: () => './RDKit_minimal.wasm' })
    .then((mod) => {
      instance = mod
      console.log(`[ChemCanvas] RDKit loaded — version ${mod.version()}`)
      return mod
    })
  return loading
}

/** Throws if called before init completes — guard with isRDKitReady() or await initRDKit(). */
export function getRDKit(): RDKitModule {
  if (!instance) throw new Error('RDKit is not initialized yet')
  return instance
}

export function isRDKitReady(): boolean {
  return instance !== null
}
