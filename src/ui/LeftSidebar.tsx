import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  deleteCustomTemplate,
  loadCustomTemplates,
  saveCustomTemplate,
  TEMPLATE_LIBRARY,
  type CustomTemplate,
} from '../model/templateLibrary'
import { placeStructureFromSmiles } from '../state/actions'
import { fragmentSmiles, selectedFragment } from '../state/clipboard'
import { useEditorStore } from '../state/editor'
import { useUIStore } from '../state/store'
import { toast } from './Toasts'

const OPEN_KEY = 'chemcanvas:accordion'

function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* defaults below */
  }
  return { rings: true }
}

export default function LeftSidebar() {
  const leftOpen = useUIStore((s) => s.leftOpen)
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpenGroups)
  const [custom, setCustom] = useState<CustomTemplate[]>(loadCustomTemplates)
  const hasSelection = useEditorStore((s) => s.selection.atomIds.size > 0)

  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] }
    setOpen(next)
    localStorage.setItem(OPEN_KEY, JSON.stringify(next))
  }

  const saveSelection = () => {
    const frag = selectedFragment()
    if (!frag) return
    const smiles = fragmentSmiles(frag)
    if (!smiles) {
      toast('Selection could not be converted to a template.', 'error')
      return
    }
    const name = smiles.length > 18 ? `${smiles.slice(0, 18)}…` : smiles
    const tpl = saveCustomTemplate(name, smiles)
    setCustom(loadCustomTemplates())
    toast(`Saved template — ${tpl.name}`, 'success')
  }

  const groups = [
    ...TEMPLATE_LIBRARY,
    { id: 'custom', title: 'Custom', items: custom.map((c) => ({ name: c.name, smiles: c.smiles })) },
  ]

  return (
    <aside
      aria-label="Templates"
      aria-hidden={!leftOpen}
      className="no-print shrink-0 overflow-hidden border-r border-edge bg-panel transition-[width] duration-200"
      style={{ width: leftOpen ? 232 : 0 }}
    >
      <div className="flex h-full w-[232px] flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[15px] font-medium text-primary">Templates</span>
          {hasSelection && (
            <button
              type="button"
              onClick={saveSelection}
              title="Save selection as template"
              className="flex h-6 items-center gap-1 rounded-[6px] border border-edge px-1.5 text-[11px] text-secondary transition-colors duration-150 hover:bg-hover hover:text-primary"
            >
              <Plus size={11} /> Save
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          {groups.map((g) => (
            <div key={g.id}>
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={!!open[g.id]}
                className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[11px] font-medium tracking-wide text-muted uppercase transition-colors duration-150 hover:text-secondary"
              >
                <ChevronRight
                  size={11}
                  className={`transition-transform duration-150 ${open[g.id] ? 'rotate-90' : ''}`}
                />
                {g.title}
                <span className="font-normal">({g.items.length})</span>
              </button>
              {open[g.id] && (
                <div className="grid grid-cols-2 gap-1 px-3 pb-2">
                  {g.items.map((item, i) => (
                    <div key={`${item.name}-${i}`} className="group relative">
                      <button
                        type="button"
                        onClick={() => placeStructureFromSmiles(item.smiles, item.name)}
                        title={item.smiles}
                        className="w-full truncate rounded-[4px] border border-edge bg-toolbar px-1.5 py-1.5 text-left text-[12px] text-secondary transition-colors duration-150 hover:border-edge-strong hover:bg-hover hover:text-primary"
                      >
                        {item.name}
                      </button>
                      {g.id === 'custom' && (
                        <button
                          type="button"
                          aria-label={`Delete template ${item.name}`}
                          onClick={() => {
                            const tpl = custom[i]
                            if (tpl) {
                              deleteCustomTemplate(tpl.id)
                              setCustom(loadCustomTemplates())
                            }
                          }}
                          className="absolute top-1 right-1 hidden h-4 w-4 items-center justify-center rounded-[3px] text-muted group-hover:flex hover:text-danger"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  {g.id === 'custom' && g.items.length === 0 && (
                    <p className="col-span-2 px-1 text-[11px] text-muted">
                      Select a structure, then “Save” to keep it here.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
