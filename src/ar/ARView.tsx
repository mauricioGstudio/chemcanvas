import {
  Camera,
  Hand,
  Loader2,
  Move3d,
  Pause,
  Play,
  Rss,
  RotateCcw,
  Ruler,
  Tag,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Atom3D } from '../chem/conformer'
import { precise3DEnabled, setPrecise3D } from '../chem/conformer3d'
import { ELEMENTS } from '../model/elements'
import { useARStore } from '../state/ar'
import { toast } from '../ui/Toasts'
import {
  createGestureMemory,
  detectHands,
  disposeHandTracking,
  HAND_CONNECTIONS,
  initHandTracking,
  interpretGestures,
  type HandsFrame,
} from './hands'
import { MoleculeScene, type DisplayMode } from './scene3d'

/**
 * Fullscreen AR viewer: every structure from the canvas, laid out side by
 * side in real WebGL, over the live camera.
 *
 * Nothing moves on its own. Pinching (or clicking) any part of a molecule
 * makes it the focus: it grows where it stands, everything else dims, and it
 * is the only thing gestures reach until you pinch clear of it. Turning it
 * takes a second, deliberate pinch on one of its atoms — so a hand crossing
 * the frame can't nudge the structure you're reading.
 *
 * Degradation is layered, because cameras and models fail for ordinary
 * reasons: camera + hands → gestures; camera only → click and drag; neither
 * → drag on a plain backdrop. The scene is always usable.
 */

type TrackState = 'off' | 'loading' | 'on' | 'failed'

const MODE_LABEL: Record<DisplayMode, string> = {
  'ball-stick': 'Ball & stick',
  spacefill: 'Space-filling',
  wireframe: 'Wireframe',
}

interface ViewState {
  yaw: number
  pitch: number
  /** Camera distance in Ångström — whole-scene zoom, used when nothing is focused. */
  distance: number
}

interface Pick {
  moleculeId: string
  atom: Atom3D
}

export default function ARView() {
  const open = useARStore((s) => s.open)
  const building = useARStore((s) => s.building)
  const buildDone = useARStore((s) => s.buildDone)
  const buildTotal = useARStore((s) => s.buildTotal)
  const entries = useARStore((s) => s.entries)
  const focusedId = useARStore((s) => s.focusedId)
  const close = useARStore((s) => s.close)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sceneRef = useRef<MoleculeScene | null>(null)
  const rafRef = useRef(0)
  const gestureMem = useRef(createGestureMemory())
  const handsRef = useRef<HandsFrame>([])
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(
    null,
  )
  const spinRef = useRef(true)
  const focusedIdRef = useRef<string | null>(null)
  const measuringRef = useRef(false)
  /**
   * True only between a pinch (or press) that landed on an atom of the
   * focused molecule and its release. Rotation is gated on this so a hand
   * merely moving through frame — pinched or not — never disturbs the
   * molecule you are working on.
   */
  const rotatingRef = useRef(false)
  const view = useRef<ViewState>({ yaw: 0.6, pitch: 0.3, distance: 30 })

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackState>('off')
  const [mode, setMode] = useState<DisplayMode>('ball-stick')
  const [showLabels, setShowLabels] = useState(true)
  const [showHydrogens, setShowHydrogens] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [autoSpin, setAutoSpin] = useState(true)
  const [hint, setHint] = useState('Starting camera…')
  const [selected, setSelected] = useState<Pick | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [measurePicks, setMeasurePicks] = useState<Pick[]>([])
  const [precise3D, setPrecise3DState] = useState(precise3DEnabled)

  spinRef.current = autoSpin
  focusedIdRef.current = focusedId
  measuringRef.current = measuring

  const focusedEntry = entries.find((e) => e.id === focusedId) ?? null

  // ---- camera -------------------------------------------------------------
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const startTracking = async () => {
      setTrack('loading')
      try {
        await initHandTracking()
        if (cancelled) return
        setTrack('on')
        setHint('Pinch a molecule to select it')
      } catch {
        if (cancelled) return
        setTrack('failed')
        setHint('Hand tracking unavailable — click and drag instead')
      }
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser has no camera API.')
        setHint('Click a molecule to select it, then drag')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCameraOn(true)
        setHint('Loading hand tracking…')
        void startTracking()
      } catch (err) {
        const name = (err as Error)?.name
        setCameraError(
          name === 'NotAllowedError'
            ? 'Camera permission denied — click a molecule and drag instead.'
            : name === 'NotFoundError'
              ? 'No camera found — click a molecule and drag instead.'
              : 'Could not start the camera — click a molecule and drag instead.',
        )
        setHint('Click a molecule to select it, then drag')
      }
    }

    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      disposeHandTracking()
      setCameraOn(false)
      setTrack('off')
      setCameraError(null)
    }
  }, [open])

  // ---- scene construction (once entries first arrive) ----------------------
  const hasEntries = entries.length > 0
  useEffect(() => {
    if (!open || !hasEntries || !canvasRef.current || sceneRef.current) return
    const scene = new MoleculeScene(
      canvasRef.current,
      entries.map((e) => ({ id: e.id, conformer: e.conformer })),
      { mode, showHydrogens, showLabels },
    )
    sceneRef.current = scene
    view.current.distance = scene.fitDistance()
    // Dev-only: expose for debugging/self-tests from the browser console.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__arScene = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__arScene = null
    }
    // Intentionally only reacts to open/hasEntries — mode etc. are pushed
    // via setOptions below, and per-entry conformer swaps via setEntries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasEntries])

  // Sync geometry updates (precise-3D upgrades) into the live scene.
  useEffect(() => {
    sceneRef.current?.setEntries(entries.map((e) => ({ id: e.id, conformer: e.conformer })))
  }, [entries])

  useEffect(() => {
    sceneRef.current?.setOptions({ mode, showHydrogens, showLabels })
  }, [mode, showHydrogens, showLabels])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setFocusHighlight(focusedId)
    scene.setFocusExpansion(focusedId, view.current.distance)
  }, [focusedId])

  /**
   * Change focus and grow or shrink to match, without waiting for a re-render.
   * The ref is written directly because the render loop reads it on the same
   * frame the pinch lands — going through state alone would be one frame late.
   */
  const applyFocus = useCallback((id: string | null) => {
    focusedIdRef.current = id
    useARStore.getState().setFocus(id)
    const scene = sceneRef.current
    if (!scene) return
    scene.setFocusHighlight(id)
    scene.setFocusExpansion(id, view.current.distance)
  }, [])

  /**
   * A pinch or click landing somewhere in the scene.
   *
   * With nothing focused, hitting any part of a molecule — atom or bond —
   * makes it the focus and expands it. Once something is focused the rules
   * narrow: one of its atoms starts a rotation, anywhere else still over it
   * does nothing, and only a pinch clear of it gives the focus back up.
   */
  const handlePinch = useCallback(
    (scene: MoleculeScene, ndcX: number, ndcY: number) => {
      const hit = scene.pick(ndcX, ndcY)

      if (measuringRef.current) {
        if (!hit) return
        setMeasurePicks((prev) => {
          const p = { moleculeId: hit.moleculeId, atom: hit.atom }
          // Cross-molecule measurement isn't chemically meaningful — starting
          // a pick on a different structure restarts the chain there instead.
          if (prev.length > 0 && prev[0].moleculeId !== hit.moleculeId) return [p]
          return prev.length >= 3 ? [p] : [...prev, p]
        })
        return
      }

      const focus = focusedIdRef.current
      if (focus) {
        if (hit && hit.moleculeId === focus) {
          rotatingRef.current = true
          setSelected({ moleculeId: hit.moleculeId, atom: hit.atom })
          return
        }
        // Over the focused molecule but between its atoms: keep it. Only a
        // pinch clear of the whole structure counts as letting go.
        if (scene.withinBounds(focus, ndcX, ndcY)) return
        applyFocus(null)
        setSelected(null)
        return
      }

      const picked = hit?.moleculeId ?? scene.pickMolecule(ndcX, ndcY)
      if (!picked) return
      rotatingRef.current = false
      applyFocus(picked)
      setSelected(hit ? { moleculeId: hit.moleculeId, atom: hit.atom } : null)
    },
    [applyFocus],
  )

  // ---- render loop ----------------------------------------------------------
  useEffect(() => {
    if (!open || !hasEntries) return
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas || !overlay) return

    let lastT = performance.now()

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop)
      const scene = sceneRef.current
      if (!scene) return
      const dt = (t - lastT) / 1000
      lastT = t

      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      scene.resize(w, h, dpr)
      if (overlay.width !== w * dpr || overlay.height !== h * dpr) {
        overlay.width = w * dpr
        overlay.height = h * dpr
      }

      const video = videoRef.current
      if (track === 'on' && video && video.readyState >= 2) {
        const hands = detectHands(video, t)
        handsRef.current = hands
        const g = interpretGestures(hands, gestureMem.current)

        if (g.pinchStarted) {
          const ndcX = g.pinchStarted.x * 2 - 1
          const ndcY = -(g.pinchStarted.y * 2 - 1)
          handlePinch(scene, ndcX, ndcY)
        }
        // Letting go ends the rotation, whatever happens next.
        if (!g.pinchActive) rotatingRef.current = false

        // Read after handlePinch: it updates the ref itself rather than
        // waiting for a re-render, so a pinch takes effect on its own frame.
        const focus = focusedIdRef.current

        if (g.mode === 'rotate' && g.pinchActive && focus && rotatingRef.current) {
          scene.rotateInstance(focus, g.dYaw, g.dPitch)
        }
        if (g.mode === 'scale' && g.scaleFactor !== 1) {
          if (focus) scene.scaleInstance(focus, g.scaleFactor)
          else view.current.distance = clamp(view.current.distance / g.scaleFactor, 4, 500)
        }
        // Hand-distance depth moves the camera, and only when nothing is
        // focused. It used to push the focused molecule back and forth, which
        // meant the structure you were working on drifted whenever your hand
        // did — including when you weren't pinching at all.
        if (g.depthFactor !== 1 && !focus) {
          view.current.distance = clamp(view.current.distance * g.depthFactor, 4, 500)
        }

        setHintThrottled(
          focus
            ? g.mode === 'scale'
              ? 'Move hands apart or together to resize'
              : rotatingRef.current
                ? 'Move your hand to turn it'
                : 'Pinch an atom to turn it — pinch away to let it go'
            : 'Pinch a molecule to select it',
        )
      }

      const focus = focusedIdRef.current
      if (spinRef.current && !dragRef.current && !rotatingRef.current) {
        if (focus) scene.rotateInstance(focus, 0.01, 0)
        else view.current.yaw += 0.006
      }

      scene.update(dt)

      // Whole-scene orbit only applies when nothing is focused — a focused
      // molecule is manipulated on its own, in place.
      scene.root.rotation.set(view.current.pitch, view.current.yaw, 0)
      const cam = scene.camera
      cam.position.set(0, 0, view.current.distance)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      scene.render()

      drawOverlay(overlay, dpr, w, h, scene, handsRef.current, showSkeleton, measurePicks, selected)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [open, hasEntries, track, showSkeleton, measurePicks, selected, handlePinch])

  // Avoid a setState every frame; the hint only changes on gesture changes.
  const lastHint = useRef('')
  const setHintThrottled = (h: string) => {
    if (h !== lastHint.current) {
      lastHint.current = h
      setHint(h)
    }
  }

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (measuringRef.current) {
          setMeasuring(false)
          setMeasurePicks([])
        } else if (focusedIdRef.current) {
          rotatingRef.current = false
          applyFocus(null)
          setSelected(null)
        } else {
          close()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, applyFocus])

  const resetView = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.resetAllTransforms()
    view.current = { yaw: 0.6, pitch: 0.3, distance: scene.fitDistance() }
    rotatingRef.current = false
    applyFocus(null)
    setSelected(null)
    setMeasurePicks([])
  }, [applyFocus])

  /** Save a still of the camera feed plus the scene. */
  const capture = useCallback(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const video = videoRef.current
    if (!canvas) return
    const out = document.createElement('canvas')
    out.width = canvas.clientWidth
    out.height = canvas.clientHeight
    const c = out.getContext('2d')
    if (!c) return
    if (cameraOn && video && video.readyState >= 2) {
      c.save()
      c.translate(out.width, 0)
      c.scale(-1, 1)
      const vr = video.videoWidth / video.videoHeight
      const or_ = out.width / out.height
      let dw = out.width
      let dh = out.height
      if (vr > or_) dw = out.height * vr
      else dh = out.width / vr
      c.drawImage(video, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)
      c.restore()
    } else {
      c.fillStyle = '#0e1015'
      c.fillRect(0, 0, out.width, out.height)
    }
    c.drawImage(canvas, 0, 0, out.width, out.height)
    if (overlay) c.drawImage(overlay, 0, 0, out.width, out.height)
    out.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chemcanvas-ar-${Date.now()}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast('Saved AR photo.', 'success')
    }, 'image/png')
  }, [cameraOn])

  if (!open) return null

  // ---- pointer input (mouse/touch fallback) ----------------------------------
  /** Canvas-relative normalized device coordinates for a pointer event. */
  const ndcOf = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    }
  }

  const pointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }
    // Mirrors the pinch rule: a drag only turns the focused molecule if it
    // began on one of its atoms.
    const scene = sceneRef.current
    const focus = focusedIdRef.current
    const ndc = ndcOf(e)
    rotatingRef.current = false
    if (scene && ndc && focus && !measuringRef.current) {
      const hit = scene.pick(ndc.x, ndc.y)
      rotatingRef.current = hit?.moleculeId === focus
    }
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }
  const pointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // Measured from the press point, not the last move: a slow drag arrives as
    // many sub-pixel steps, and per-step comparison would never trip the
    // threshold — so releasing it would fire a pick and drop the focus.
    const moved =
      d.moved || Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3
    const scene = sceneRef.current
    const focus = focusedIdRef.current
    if (focus) {
      // Anything but an atom-started drag leaves it alone: orbiting the scene
      // would slide the focused molecule across the screen, and it is meant to
      // stay put unless you are turning it.
      if (rotatingRef.current && scene) scene.rotateInstance(focus, dx * 0.01, dy * 0.01)
    } else {
      view.current.yaw += dx * 0.01
      view.current.pitch = clamp(view.current.pitch + dy * 0.01, -1.6, 1.6)
    }
    dragRef.current = { x: e.clientX, y: e.clientY, startX: d.startX, startY: d.startY, moved }
  }
  const pointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    rotatingRef.current = false
    if (!d || d.moved) return
    // A click without drag is a pick, mirroring pinch-to-select.
    const scene = sceneRef.current
    const ndc = ndcOf(e)
    if (!scene || !ndc) return
    handlePinch(scene, ndc.x, ndc.y)
  }
  const onWheel = (e: React.WheelEvent) => {
    const scene = sceneRef.current
    const focus = focusedIdRef.current
    if (focus && scene) {
      scene.scaleInstance(focus, Math.exp(-e.deltaY * 0.0015))
    } else {
      view.current.distance = clamp(view.current.distance * Math.exp(e.deltaY * 0.0012), 4, 500)
    }
  }

  const measureReadout = describeMeasurement(measurePicks)
  const totalAtoms = entries.reduce((n, e) => n + e.conformer.atoms.length, 0)
  const headerTitle = focusedEntry
    ? focusedEntry.label
    : entries.length === 1
      ? entries[0].label
      : entries.length > 1
        ? `${entries.length} structures`
        : ''
  const headerSub = focusedEntry
    ? `${focusedEntry.conformer.atoms.length} atoms · ${MODE_LABEL[mode]}`
    : hasEntries
      ? `${totalAtoms} atoms total · ${MODE_LABEL[mode]}`
      : 'Building 3D structures…'

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)', opacity: cameraOn ? 1 : 0 }}
      />
      {!cameraOn && (
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at 50% 40%, #1c2030, #0b0d12)' }}
        />
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => (dragRef.current = null)}
        onWheel={onWheel}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="rounded-[10px] bg-black/55 px-3 py-2 backdrop-blur">
          <div className="text-[15px] font-semibold text-white">{headerTitle || 'ChemCanvas AR'}</div>
          <div className="text-[12px] text-white/70">{headerSub}</div>
          {focusedEntry && (
            <div className="text-[11px] text-white/45">
              {focusedEntry.precise ? 'measured 3D geometry' : 'idealized geometry'}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Exit AR"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
        >
          <X size={18} />
        </button>
      </div>

      {/* building progress */}
      {building && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[240px] rounded-[14px] bg-black/70 p-5 text-center text-white backdrop-blur">
            <div className="text-[14px] font-semibold">Building 3D structures…</div>
            <div className="mt-1 text-[12px] text-white/60">
              {buildDone} of {buildTotal}
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-200"
                style={{ width: `${buildTotal > 0 ? Math.round((buildDone / buildTotal) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* status */}
      {!building && (
        <div className="pointer-events-none absolute inset-x-0 top-[76px] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] text-white/90 backdrop-blur">
            {track === 'loading' && <Loader2 size={13} className="animate-spin" />}
            {track === 'on' && <Hand size={13} />}
            <span>{cameraError ?? hint}</span>
          </div>
        </div>
      )}

      {/* atom inspector — the AR counterpart of the properties panel */}
      {selected && !measuring && (
        <div className="absolute top-[120px] right-4 w-[190px] rounded-[10px] bg-black/60 p-3 text-white backdrop-blur">
          <div className="flex items-baseline justify-between">
            <span className="text-[20px] font-bold">{selected.atom.element}</span>
            <span className="text-[11px] text-white/60">
              {ELEMENTS[selected.atom.element]?.name ?? 'atom'}
            </span>
          </div>
          <dl className="mt-2 space-y-1 text-[12px]">
            <Row k="Atomic number" v={String(ELEMENTS[selected.atom.element]?.z ?? '—')} />
            <Row k="Mass" v={`${ELEMENTS[selected.atom.element]?.mass ?? '—'}`} />
            {selected.atom.charge !== 0 && (
              <Row
                k="Charge"
                v={selected.atom.charge > 0 ? `+${selected.atom.charge}` : String(selected.atom.charge)}
              />
            )}
            <Row k="Kind" v={selected.atom.implicit ? 'added hydrogen' : 'drawn atom'} />
          </dl>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mt-2 w-full rounded-[6px] bg-white/10 py-1 text-[12px] hover:bg-white/20"
          >
            Clear
          </button>
        </div>
      )}

      {/* measurement readout */}
      {measuring && (
        <div className="absolute top-[120px] right-4 w-[200px] rounded-[10px] bg-black/60 p-3 text-white backdrop-blur">
          <div className="text-[13px] font-semibold">Measure</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-white/70">
            {measurePicks.length === 0
              ? 'Pick two atoms for a bond length, three for an angle.'
              : measurePicks.map((p) => p.atom.element).join(' → ')}
          </p>
          {measureReadout && (
            <div className="mt-2 rounded-[6px] bg-white/10 px-2 py-1.5 font-mono text-[15px]">
              {measureReadout}
            </div>
          )}
          <button
            type="button"
            onClick={() => setMeasurePicks([])}
            className="mt-2 w-full rounded-[6px] bg-white/10 py-1 text-[12px] hover:bg-white/20"
          >
            Clear picks
          </button>
        </div>
      )}

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-4">
        <Ctl
          onClick={() =>
            setMode(mode === 'ball-stick' ? 'spacefill' : mode === 'spacefill' ? 'wireframe' : 'ball-stick')
          }
        >
          {MODE_LABEL[mode]}
        </Ctl>
        <Ctl onClick={() => setShowLabels(!showLabels)} active={showLabels}>
          <Tag size={14} /> Labels
        </Ctl>
        <Ctl onClick={() => setShowHydrogens(!showHydrogens)} active={showHydrogens}>
          H atoms
        </Ctl>
        <Ctl
          onClick={() => {
            setMeasuring(!measuring)
            setMeasurePicks([])
            setSelected(null)
          }}
          active={measuring}
        >
          <Ruler size={14} /> Measure
        </Ctl>
        <Ctl onClick={() => setAutoSpin(!autoSpin)} active={autoSpin}>
          {autoSpin ? <Pause size={14} /> : <Play size={14} />} Spin
        </Ctl>
        {track === 'on' && (
          <Ctl onClick={() => setShowSkeleton(!showSkeleton)} active={showSkeleton}>
            <Rss size={14} /> Tracking
          </Ctl>
        )}
        <Ctl onClick={resetView}>
          <RotateCcw size={14} /> Reset
        </Ctl>
        <Ctl
          onClick={() => {
            const next = !precise3D
            setPrecise3D(next)
            setPrecise3DState(next)
            toast(
              next
                ? 'Precise geometry on — structures are sent to NCI CACTUS.'
                : 'Precise geometry off — shapes are built on this device only.',
              'info',
            )
          }}
          active={precise3D}
        >
          <Move3d size={14} /> Precise 3D
        </Ctl>
        <Ctl onClick={capture}>
          <Camera size={14} /> Photo
        </Ctl>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-[68px] flex items-center justify-center gap-1.5 text-center text-[11px] text-white/45">
        {focusedEntry
          ? focusedEntry.precise
            ? 'Embedded 3D coordinates from the NCI structure service.'
            : 'Shape built on this device from idealized bond angles — not an energy-minimized conformer.'
          : entries.length > 1
            ? 'Pinch or click a molecule to expand it, then pinch an atom to turn it.'
            : 'Shape built on this device from idealized bond angles — not an energy-minimized conformer.'}
      </p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-white/55">{k}</dt>
      <dd className="font-mono">{v}</dd>
    </div>
  )
}

function Ctl({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium backdrop-blur transition-colors ${
        active ? 'bg-white text-black' : 'bg-black/55 text-white hover:bg-black/75'
      }`}
    >
      {children}
    </button>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Bond length for two picks, bond angle for three — always within one molecule. */
function describeMeasurement(picks: Pick[]): string | null {
  const d = (a: Atom3D, b: Atom3D) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  if (picks.length === 2) return `${d(picks[0].atom, picks[1].atom).toFixed(2)} Å`
  if (picks.length === 3) {
    const [a, b, c] = picks.map((p) => p.atom)
    const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
    const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
    const dotv = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z
    const l1 = Math.hypot(v1.x, v1.y, v1.z)
    const l2 = Math.hypot(v2.x, v2.y, v2.z)
    if (l1 < 1e-6 || l2 < 1e-6) return null
    const ang = (Math.acos(clamp(dotv / (l1 * l2), -1, 1)) * 180) / Math.PI
    return `${ang.toFixed(1)}°`
  }
  return null
}

/**
 * 2D overlay drawn above the WebGL canvas: hand skeleton, selection ring,
 * and measurement lines. Screen-space work like this is far simpler in 2D
 * than as 3D geometry, and it always draws on top.
 */
function drawOverlay(
  canvas: HTMLCanvasElement,
  dpr: number,
  w: number,
  h: number,
  scene: MoleculeScene,
  hands: HandsFrame,
  showSkeleton: boolean,
  measurePicks: Pick[],
  selected: Pick | null,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const project = (p: Pick) => scene.projectToScreen(scene.worldPositionOf(p.moleculeId, p.atom), w, h)

  if (selected) {
    const p = project(selected)
    if (!p.behind) {
      ctx.strokeStyle = 'rgba(90,190,255,0.95)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  if (measurePicks.length > 0) {
    const pts = measurePicks.map(project).filter((p) => !p.behind)
    ctx.strokeStyle = 'rgba(255,214,102,0.95)'
    ctx.lineWidth = 2.5
    ctx.setLineDash([7, 5])
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,214,102,0.95)'
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (showSkeleton && hands.length > 0) {
    for (const hand of hands) {
      const pts = hand.points.map((p) => ({ x: p.x * w, y: p.y * h }))
      ctx.strokeStyle = hand.pinching ? 'rgba(90,220,140,0.9)' : 'rgba(255,255,255,0.45)'
      ctx.lineWidth = 2
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath()
        ctx.moveTo(pts[a].x, pts[a].y)
        ctx.lineTo(pts[b].x, pts[b].y)
        ctx.stroke()
      }
      ctx.fillStyle = hand.pinching ? 'rgba(90,220,140,0.95)' : 'rgba(255,255,255,0.7)'
      for (const p of pts) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
