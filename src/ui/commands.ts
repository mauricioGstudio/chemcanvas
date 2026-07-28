import { docBounds } from '../model/graph'
import { placeStructureFromSmiles } from '../state/actions'
import { redo, undo, useDocStore } from '../state/doc'
import { copyAsImage, exportPDF, exportPNG, exportSVG } from '../chem/export'
import { identifySelection } from '../state/identify'
import { autoLayoutReaction, bracketSelection, cleanUpMolecules } from '../state/docActions'
import { useEditorStore } from '../state/editor'
import { useUIStore } from '../state/store'
import { combo, MOD, SHIFT } from './platform'
import { toast } from './Toasts'

export interface Command {
  id: string
  title: string
  keywords: string
  shortcut?: string
  run: () => void
}

/**
 * The command registry behind the ⌘K palette. Later phases register more
 * commands via registerCommands().
 */
const registry: Command[] = [
  {
    id: 'theme',
    title: 'Toggle dark / light mode',
    keywords: 'theme dark light mode appearance',
    run: () => useUIStore.getState().toggleTheme(),
  },
  {
    id: 'zoom-fit',
    title: 'Zoom to fit',
    keywords: 'zoom fit view center',
    shortcut: combo(MOD, '0'),
    run: () => useEditorStore.getState().fitView(docBounds(useDocStore.getState().molecules)),
  },
  {
    id: 'zoom-100',
    title: 'Zoom to 100%',
    keywords: 'zoom actual size reset',
    shortcut: combo(MOD, '1'),
    run: () => useEditorStore.getState().setZoom(1),
  },
  {
    id: 'grid',
    title: 'Toggle grid snapping',
    keywords: 'grid snap align',
    shortcut: 'G',
    run: () => useEditorStore.getState().toggleGridSnap(),
  },
  {
    id: 'left-panel',
    title: 'Toggle templates panel',
    keywords: 'templates sidebar left panel',
    run: () => useUIStore.getState().toggleLeft(),
  },
  {
    id: 'right-panel',
    title: 'Toggle properties panel',
    keywords: 'properties inspector right panel',
    run: () => useUIStore.getState().toggleRight(),
  },
  {
    id: 'high-contrast',
    title: 'Toggle high contrast',
    keywords: 'contrast accessibility a11y',
    run: () => {
      const s = useUIStore.getState()
      s.setHighContrast(!s.highContrast)
    },
  },
  {
    id: 'add-benzene',
    title: 'Add benzene',
    keywords: 'benzene ring phenyl insert add',
    run: () => placeStructureFromSmiles('c1ccccc1', 'benzene'),
  },
  {
    id: 'undo',
    title: 'Undo',
    keywords: 'undo back revert',
    shortcut: combo(MOD, 'Z'),
    run: () => undo(),
  },
  {
    id: 'redo',
    title: 'Redo',
    keywords: 'redo forward repeat',
    shortcut: combo(MOD, SHIFT, 'Z'),
    run: () => redo(),
  },
  {
    id: 'clean-up',
    title: 'Clean up structure layout',
    keywords: 'clean up tidy layout coordinates beautify',
    shortcut: combo(MOD, 'L'),
    run: () => {
      const n = cleanUpMolecules()
      if (n > 0) toast(`Cleaned up ${n} structure${n > 1 ? 's' : ''}.`, 'success')
    },
  },
  {
    id: 'name-structure',
    title: 'Name this structure',
    keywords: 'name identify what is this reverse lookup iupac molecule to text compound',
    shortcut: combo(MOD, SHIFT, 'N'),
    run: () => identifySelection(),
  },
  {
    id: 'export-png',
    title: 'Export PNG (300 dpi)',
    keywords: 'export png image 300 dpi download save picture',
    run: () => void exportPNG(300),
  },
  {
    id: 'export-png-600',
    title: 'Export PNG (600 dpi)',
    keywords: 'export png image 600 dpi high resolution',
    run: () => void exportPNG(600),
  },
  {
    id: 'export-svg',
    title: 'Export SVG',
    keywords: 'export svg vector download save',
    run: () => exportSVG(),
  },
  {
    id: 'export-pdf',
    title: 'Export PDF',
    keywords: 'export pdf document download save',
    run: () => void exportPDF(),
  },
  {
    id: 'copy-image',
    title: 'Copy canvas as image',
    keywords: 'copy image clipboard picture screenshot',
    shortcut: combo(MOD, SHIFT, 'C'),
    run: () => void copyAsImage(),
  },
  {
    id: 'history-panel',
    title: 'Toggle history panel',
    keywords: 'history undo steps timeline',
    shortcut: combo(MOD, SHIFT, 'H'),
    run: () => {
      const ui = useUIStore.getState()
      ui.setHistoryOpen(!ui.historyOpen)
    },
  },
  {
    id: 'auto-layout-reaction',
    title: 'Auto-layout reaction',
    keywords: 'reaction layout arrange align scheme arrow',
    run: () => {
      if (!autoLayoutReaction()) toast('Draw a reaction arrow first.', 'info')
    },
  },
  {
    id: 'bracket-selection',
    title: 'Bracket selection (polymer repeat)',
    keywords: 'bracket polymer repeat markush sru',
    run: () => {
      if (!bracketSelection('square', 'n')) toast('Select some atoms first.', 'info')
    },
  },
  {
    id: 'clear',
    title: 'Clear canvas',
    keywords: 'clear delete all new document reset',
    run: () => {
      useDocStore.getState().clearDoc()
      useEditorStore.getState().clearSelection()
      toast('Canvas cleared — undo with ' + combo(MOD, 'Z'), 'info')
    },
  },
]

export function registerCommands(cmds: Command[]) {
  for (const c of cmds) {
    if (!registry.some((r) => r.id === c.id)) registry.push(c)
  }
}

/** Simple scored match over title + keywords. */
export function matchCommands(query: string, limit = 5): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored = registry
    .map((c) => {
      const title = c.title.toLowerCase()
      let score = 0
      if (title.startsWith(q)) score = 3
      else if (title.includes(q)) score = 2
      else if (c.keywords.includes(q)) score = 1
      else {
        // all query words must appear somewhere
        const words = q.split(/\s+/)
        if (words.every((w) => title.includes(w) || c.keywords.includes(w))) score = 1
      }
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.c)
}
