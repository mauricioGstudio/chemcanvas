/** Compact periodic-table data for the elements a structure editor meets in practice. */
export interface ElementInfo {
  z: number
  mass: number
  name: string
  /** Allowed neutral valences, lowest preferred; empty = don't warn. */
  valences: number[]
}

export const ELEMENTS: Record<string, ElementInfo> = {
  H: { z: 1, mass: 1.008, name: 'Hydrogen', valences: [1] },
  He: { z: 2, mass: 4.0026, name: 'Helium', valences: [0] },
  Li: { z: 3, mass: 6.94, name: 'Lithium', valences: [1] },
  Be: { z: 4, mass: 9.0122, name: 'Beryllium', valences: [2] },
  B: { z: 5, mass: 10.81, name: 'Boron', valences: [3] },
  C: { z: 6, mass: 12.011, name: 'Carbon', valences: [4] },
  N: { z: 7, mass: 14.007, name: 'Nitrogen', valences: [3] },
  O: { z: 8, mass: 15.999, name: 'Oxygen', valences: [2] },
  F: { z: 9, mass: 18.998, name: 'Fluorine', valences: [1] },
  Ne: { z: 10, mass: 20.18, name: 'Neon', valences: [0] },
  Na: { z: 11, mass: 22.99, name: 'Sodium', valences: [1] },
  Mg: { z: 12, mass: 24.305, name: 'Magnesium', valences: [2] },
  Al: { z: 13, mass: 26.982, name: 'Aluminium', valences: [3] },
  Si: { z: 14, mass: 28.085, name: 'Silicon', valences: [4] },
  P: { z: 15, mass: 30.974, name: 'Phosphorus', valences: [3, 5] },
  S: { z: 16, mass: 32.06, name: 'Sulfur', valences: [2, 4, 6] },
  Cl: { z: 17, mass: 35.45, name: 'Chlorine', valences: [1] },
  Ar: { z: 18, mass: 39.948, name: 'Argon', valences: [0] },
  K: { z: 19, mass: 39.098, name: 'Potassium', valences: [1] },
  Ca: { z: 20, mass: 40.078, name: 'Calcium', valences: [2] },
  Ti: { z: 22, mass: 47.867, name: 'Titanium', valences: [] },
  Cr: { z: 24, mass: 51.996, name: 'Chromium', valences: [] },
  Mn: { z: 25, mass: 54.938, name: 'Manganese', valences: [] },
  Fe: { z: 26, mass: 55.845, name: 'Iron', valences: [] },
  Co: { z: 27, mass: 58.933, name: 'Cobalt', valences: [] },
  Ni: { z: 28, mass: 58.693, name: 'Nickel', valences: [] },
  Cu: { z: 29, mass: 63.546, name: 'Copper', valences: [] },
  Zn: { z: 30, mass: 65.38, name: 'Zinc', valences: [2] },
  Ga: { z: 31, mass: 69.723, name: 'Gallium', valences: [3] },
  Ge: { z: 32, mass: 72.63, name: 'Germanium', valences: [4] },
  As: { z: 33, mass: 74.922, name: 'Arsenic', valences: [3, 5] },
  Se: { z: 34, mass: 78.971, name: 'Selenium', valences: [2, 4, 6] },
  Br: { z: 35, mass: 79.904, name: 'Bromine', valences: [1] },
  Kr: { z: 36, mass: 83.798, name: 'Krypton', valences: [0] },
  Rb: { z: 37, mass: 85.468, name: 'Rubidium', valences: [1] },
  Sr: { z: 38, mass: 87.62, name: 'Strontium', valences: [2] },
  Zr: { z: 40, mass: 91.224, name: 'Zirconium', valences: [] },
  Mo: { z: 42, mass: 95.95, name: 'Molybdenum', valences: [] },
  Ru: { z: 44, mass: 101.07, name: 'Ruthenium', valences: [] },
  Rh: { z: 45, mass: 102.91, name: 'Rhodium', valences: [] },
  Pd: { z: 46, mass: 106.42, name: 'Palladium', valences: [] },
  Ag: { z: 47, mass: 107.87, name: 'Silver', valences: [1] },
  Cd: { z: 48, mass: 112.41, name: 'Cadmium', valences: [2] },
  In: { z: 49, mass: 114.82, name: 'Indium', valences: [3] },
  Sn: { z: 50, mass: 118.71, name: 'Tin', valences: [2, 4] },
  Sb: { z: 51, mass: 121.76, name: 'Antimony', valences: [3, 5] },
  Te: { z: 52, mass: 127.6, name: 'Tellurium', valences: [2, 4, 6] },
  I: { z: 53, mass: 126.9, name: 'Iodine', valences: [1] },
  Xe: { z: 54, mass: 131.29, name: 'Xenon', valences: [0] },
  Cs: { z: 55, mass: 132.91, name: 'Caesium', valences: [1] },
  Ba: { z: 56, mass: 137.33, name: 'Barium', valences: [2] },
  W: { z: 74, mass: 183.84, name: 'Tungsten', valences: [] },
  Re: { z: 75, mass: 186.21, name: 'Rhenium', valences: [] },
  Os: { z: 76, mass: 190.23, name: 'Osmium', valences: [] },
  Ir: { z: 77, mass: 192.22, name: 'Iridium', valences: [] },
  Pt: { z: 78, mass: 195.08, name: 'Platinum', valences: [] },
  Au: { z: 79, mass: 196.97, name: 'Gold', valences: [] },
  Hg: { z: 80, mass: 200.59, name: 'Mercury', valences: [1, 2] },
  Tl: { z: 81, mass: 204.38, name: 'Thallium', valences: [1, 3] },
  Pb: { z: 82, mass: 207.2, name: 'Lead', valences: [2, 4] },
  Bi: { z: 83, mass: 208.98, name: 'Bismuth', valences: [3, 5] },
}

const SYMBOL_BY_Z: Record<number, string> = {}
for (const [sym, info] of Object.entries(ELEMENTS)) SYMBOL_BY_Z[info.z] = sym

export function symbolForZ(z: number): string {
  return SYMBOL_BY_Z[z] ?? `#${z}`
}

export function isValidElement(symbol: string): boolean {
  return symbol in ELEMENTS
}

/**
 * Display color per element, chosen to read on both dark and light canvases.
 * Carbon uses the theme's structure stroke.
 */
export const ELEMENT_COLORS: Record<string, string> = {
  N: '#5f83e8',
  O: '#e05d52',
  F: '#4fb06d',
  Cl: '#4fb06d',
  Br: '#b06a3b',
  I: '#a05fc4',
  S: '#c19b26',
  P: '#e08a3c',
  B: '#d99a77',
  Si: '#8fa876',
  Se: '#c77f3a',
  Te: '#ad7a52',
  As: '#9b6dd0',
}

export function elementColor(symbol: string): string {
  return ELEMENT_COLORS[symbol] ?? 'var(--stroke-mol)'
}

/**
 * Covalent radii in Ångström (Cordero et al., 2008), used to derive ideal
 * bond lengths for the 3D/AR conformer.
 */
const COVALENT_RADII: Record<string, number> = {
  H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66,
  F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05,
  Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Ti: 1.6, Cr: 1.39, Mn: 1.39, Fe: 1.32,
  Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.2, As: 1.19,
  Se: 1.2, Br: 1.2, Kr: 1.16, Rb: 2.2, Sr: 1.95, Zr: 1.75, Mo: 1.54, Ru: 1.46,
  Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Sb: 1.39,
  Te: 1.38, I: 1.39, Xe: 1.4, Cs: 2.44, Ba: 2.15, W: 1.62, Re: 1.51, Os: 1.44,
  Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Tl: 1.45, Pb: 1.46, Bi: 1.48,
}

export function covalentRadius(symbol: string): number {
  return COVALENT_RADII[symbol] ?? 0.75
}

/** Van der Waals radii in Ångström — sphere sizes in the 3D/AR view. */
const VDW_RADII: Record<string, number> = {
  H: 1.2, He: 1.4, Li: 1.82, Be: 1.53, B: 1.92, C: 1.7, N: 1.55, O: 1.52,
  F: 1.47, Ne: 1.54, Na: 2.27, Mg: 1.73, Al: 1.84, Si: 2.1, P: 1.8, S: 1.8,
  Cl: 1.75, Ar: 1.88, K: 2.75, Ca: 2.31, Fe: 2.04, Ni: 1.63, Cu: 1.4,
  Zn: 1.39, Ga: 1.87, Ge: 2.11, As: 1.85, Se: 1.9, Br: 1.85, Kr: 2.02,
  Ag: 1.72, Cd: 1.58, In: 1.93, Sn: 2.17, Sb: 2.06, Te: 2.06, I: 1.98,
  Xe: 2.16, Pt: 1.75, Au: 1.66, Hg: 1.55, Tl: 1.96, Pb: 2.02,
}

export function vdwRadius(symbol: string): number {
  return VDW_RADII[symbol] ?? 1.7
}

/**
 * Literal CPK colors for 3D rendering. The 2D canvas uses theme-aware
 * colors via ELEMENT_COLORS; in AR the molecule sits over a camera feed,
 * so it needs concrete colors that read against arbitrary backgrounds.
 */
const CPK_COLORS: Record<string, string> = {
  H: '#ffffff', C: '#3c4043', N: '#3050f8', O: '#ff2010', F: '#4fe04f',
  Cl: '#25d925', Br: '#a62929', I: '#8f28d1', S: '#ffd123', P: '#ff8000',
  B: '#ffb5b5', Si: '#8f9c9c', Se: '#ffa100', Te: '#d47a00', As: '#bd80e3',
  Li: '#cc80ff', Na: '#ab5cf2', K: '#8f40d4', Mg: '#8aff00', Ca: '#3dff00',
  Fe: '#e06633', Zn: '#7d80b0', Cu: '#c88033', Ni: '#50d050', Au: '#ffd123',
  Ag: '#c0c0c0', Pt: '#d0d0e0', Hg: '#b8b8d0',
}

export function cpkColor(symbol: string): string {
  return CPK_COLORS[symbol] ?? '#e763c9'
}
