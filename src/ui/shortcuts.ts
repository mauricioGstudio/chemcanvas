import { useEffect } from 'react'
import { copyAsImage } from '../chem/export'
import { identifySelection } from '../state/identify'
import { checkSmiles } from '../chem/smiles'
import { docBounds } from '../model/graph'
import { placeStructureFromSmiles } from '../state/actions'
import { copySelection, cutSelection, duplicateSelection } from '../state/clipboard'
import { redo, undo, useDocStore } from '../state/doc'
import { cleanUpMolecules, deleteItems, setBondOrder } from '../state/docActions'
import { useEditorStore } from '../state/editor'
import { useUIStore } from '../state/store'
import { toast } from './Toasts'

function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/** Global keyboard shortcuts. Grows phase by phase. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const editor = useEditorStore.getState()
      const ui = useUIStore.getState()

      if (mod) {
        switch (e.key.toLowerCase()) {
          case 'k':
            e.preventDefault()
            ui.setPaletteOpen(!ui.paletteOpen)
            return
          case 'z':
            if (isTyping(e)) return
            e.preventDefault()
            if (e.shiftKey) redo()
            else undo()
            return
          case 'a':
            if (isTyping(e)) return
            e.preventDefault()
            editor.select({
              atomIds: useDocStore.getState().molecules.flatMap((m) => m.atoms.map((a) => a.id)),
              bondIds: useDocStore.getState().molecules.flatMap((m) => m.bonds.map((b) => b.id)),
            })
            return
          case 'l': {
            if (isTyping(e)) return
            e.preventDefault()
            // Clean up the molecules containing the selection, or everything
            const sel = editor.selection
            let molIds: Set<string> | undefined
            if (sel.atomIds.size > 0 || sel.bondIds.size > 0) {
              molIds = new Set(
                useDocStore
                  .getState()
                  .molecules.filter(
                    (m) =>
                      m.atoms.some((a) => sel.atomIds.has(a.id)) ||
                      m.bonds.some((b) => sel.bondIds.has(b.id)),
                  )
                  .map((m) => m.id),
              )
            }
            const n = cleanUpMolecules(molIds)
            if (n > 0) toast(`Cleaned up ${n} structure${n > 1 ? 's' : ''}.`, 'success')
            return
          }
          case 'c':
            if (isTyping(e)) return
            if (e.shiftKey) {
              e.preventDefault()
              void copyAsImage()
              return
            }
            if (editor.selection.atomIds.size === 0 && editor.selection.bondIds.size === 0) return
            e.preventDefault()
            void copySelection()
            return
          case 'h':
            if (isTyping(e) || !e.shiftKey) return
            e.preventDefault()
            ui.setHistoryOpen(!ui.historyOpen)
            return
          case 'n':
            if (isTyping(e) || !e.shiftKey) return
            e.preventDefault()
            identifySelection()
            return
          case 'x':
            if (isTyping(e)) return
            if (editor.selection.atomIds.size === 0 && editor.selection.bondIds.size === 0) return
            e.preventDefault()
            void cutSelection()
            return
          case 'd':
            if (isTyping(e)) return
            e.preventDefault()
            duplicateSelection()
            return
        }
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault()
            editor.zoomCentered(1.25)
            return
          case '-':
            e.preventDefault()
            editor.zoomCentered(1 / 1.25)
            return
          case '0':
            e.preventDefault()
            editor.fitView(docBounds(useDocStore.getState().molecules))
            return
          case '1':
            e.preventDefault()
            editor.setZoom(1)
            return
        }
      }

      if (isTyping(e)) return

      switch (e.key.toLowerCase()) {
        case 'g':
          editor.toggleGridSnap()
          return
        case 'h': {
          const d = ui.display
          ui.setDisplay({ showImplicitH: !d.showImplicitH })
          return
        }
        case 's':
          editor.setTool('select')
          return
        case 'a':
          editor.setTool('atom')
          return
        case 'b':
          editor.setTool('bond')
          return
        case 'r':
          editor.setTool('ring')
          return
        case 't':
          editor.setTool('text')
          return
        case 'e':
          editor.setTool('eraser')
          return
        case 'delete':
        case 'backspace':
          e.preventDefault()
          deleteItems(editor.selection.atomIds, editor.selection.bondIds)
          return
        case '1':
        case '2':
        case '3': {
          const order = Number(e.key) as 1 | 2 | 3
          if (editor.hover.bondId) {
            setBondOrder(editor.hover.bondId, order)
          } else if (editor.selection.bondIds.size > 0) {
            for (const id of editor.selection.bondIds) setBondOrder(id, order)
          } else {
            editor.setCurrentBondOrder(order)
          }
          return
        }
      }
    }

    // Paste a SMILES string anywhere on the canvas → editable structure (§5.6)
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e)) return
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      const check = checkSmiles(text)
      if (check.isSmiles && check.valid) {
        e.preventDefault()
        placeStructureFromSmiles(text)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}
