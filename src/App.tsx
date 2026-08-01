import { useEffect } from 'react'
import { initRDKit } from './chem/rdkit'
import { runChemSelfTest } from './chem/selftest'
import { restoreSession, startAutosave } from './state/persistence'
import { useUIStore } from './state/store'
import { useGlobalShortcuts } from './ui/shortcuts'
import Toolbar from './ui/Toolbar'
import LeftSidebar from './ui/LeftSidebar'
import RightPanel from './ui/RightPanel'
import BottomBar from './ui/BottomBar'
import CommandPalette from './ui/CommandPalette'
import ContextMenu from './ui/ContextMenu'
import ProjectionView from './ui/ProjectionView'
import ARView from './ar/ARView'
import NameDialog from './ui/NameDialog'
import HistoryPanel from './ui/HistoryPanel'
import Onboarding from './ui/Onboarding'
import Toasts from './ui/Toasts'
import Canvas from './canvas/Canvas'

export default function App() {
  const { rdkitLoaded, rdkitFailed } = useUIStore()
  useGlobalShortcuts()

  useEffect(() => {
    initRDKit()
      .then((mod) => {
        mod.prefer_coordgen(true)
        rdkitLoaded(mod.version())
        if (import.meta.env.DEV) runChemSelfTest()
        restoreSession()
        startAutosave()
      })
      .catch((err: unknown) => rdkitFailed(err instanceof Error ? err.message : String(err)))
  }, [rdkitLoaded, rdkitFailed])

  return (
    <div className="flex h-full flex-col bg-base">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar />
        <Canvas />
        <RightPanel />
      </div>
      <BottomBar />
      <CommandPalette />
      <ContextMenu />
      <ProjectionView />
      <NameDialog />
      <ARView />
      <HistoryPanel />
      <Onboarding />
      <Toasts />
    </div>
  )
}
