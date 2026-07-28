# ChemCanvas

A browser-based chemical structure editor — a modern replacement for ACD/ChemSketch with a clean, fast UI and one headline feature ChemSketch doesn't have: **Text-to-Molecule**. Type a chemical name or paste a SMILES string and a fully editable structure lands on the canvas.

Everything runs client-side: no backend, no login. RDKit (WASM) does all the chemistry; the app autosaves to localStorage and restores on reload.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## The 60-second tour

- **Ctrl/⌘ K** — type `caffeine` (PubChem lookup, OPSIN fallback for strict IUPAC), paste a SMILES, or run a command ("export png", "toggle dark mode").
- **Draw**: `A` atom (picker for N, O, P, S, halogens…), `B` bond (30° snapping, predictive growth — click an atom repeatedly to grow a chain), `R` rings (drop onto an atom/bond to fuse), chain tool, `T` text, `E` eraser.
- **Edit**: right-click atoms/bonds for element/charge/isotope/stereo/abbreviations; the right panel shows live RDKit properties (formula, MW, exact mass, SMILES — editable, InChI, InChIKey) with copy buttons.
- **Ctrl/⌘ L** — Clean Up: RDKit regenerates ideal 2D coordinates.
- **Reactions**: arrow tool (forward ⇌ ⇒ ↔ + curly electron-pushing), double-click an arrow for conditions text, "Auto-layout reaction" aligns reactants → arrow → products.
- **Stereo**: wedge/dash/wavy bonds; R/S and E/Z labels appear automatically (RDKit CIP); Newman projection from a bond's right-click menu.
- **Export**: PNG (72–600 DPI), clean SVG, PDF, MOL (V2000/V3000), SDF, SMILES, InChI, copy-as-image (Ctrl/⌘ ⇧ C). Import .mol/.sdf/.smi/.rxn.

## Shortcuts

| Key | Action |
| --- | --- |
| ⌘Z / ⌘⇧Z | Undo / redo (unlimited) |
| ⌘K | Search / command palette |
| ⌘L | Clean up layout |
| ⌘A / Del | Select all / delete |
| ⌘C ⌘V ⌘X ⌘D | Copy (SMILES) / paste / cut / duplicate |
| ⌘⇧C / ⌘⇧H | Copy as image / history panel |
| ⌘0 / ⌘1 / ⌘± | Zoom fit / 100% / in–out |
| S A B R T E | Tools |
| 1 2 3 | Bond order (hovered/selected bond) |
| G / H | Grid snap / implicit-H display |
| Space-drag | Pan |
| Alt-drag | Disable angle snapping |

## Architecture

```
src/chem/    RDKit boundary: molblock ⇄ graph, properties, naming, export/import
src/model/   Types, graph ops, element data, templates, abbreviations
src/state/   Zustand stores: document (zundo history), editor, UI, autosave
src/canvas/  SVG canvas, layers (molecules/reactions/brackets/ghosts), interactions
src/ui/      Toolbar, panels, palette, menus, tour, toasts
```

The editor owns the interactive graph and 2D layout; **RDKit owns all chemistry** (formula, masses, SMILES/InChI, implicit H, aromaticity, CIP stereo). The interchange format is the MDL molfile in both directions.

## Honest limitations

- CDX/CDXML import isn't supported (proprietary format) — fails with a friendly message.
- InChI *import* depends on the minimal RDKit.js build (export always works).
- Newman projections render the standard staggered conformation — 2D drawings carry no torsion information (stated in the view).
- PubChem occasionally rate-limits by IP; the palette shows a friendly retry message and OPSIN/SMILES paths keep working.
