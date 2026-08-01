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
import { ELEMENTS } from '../model/elements'
import { precise3DEnabled, setPrecise3D } from '../chem/conformer3d'
import { arMolecules, setARMolecule, useARStore } from '../state/ar'
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
import type { Atom3D } from '../chem/conformer'

/**
 * Fullscreen AR viewer: a real WebGL molecule standing in the camera feed,
 * driven by hand gestures, with the inspection tools from the 2D canvas
 * carried over so it works as a place to explore a structure rather than
 * just look at one.
 *
 * Degradation is layered, because cameras and models fail for ordinary
 * reasons: camera + hands → gestures; camera only → drag; neither → drag on
 * a plain backdrop. The molecule is always usable.
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
  /** Camera distance in Ångström — this is the depth axis. */
  distance: number
  /** Screen-space offset of the molecule, 0..1 of viewport. */
  anchorX: number
  anchorY: number
}

export default function ARView() {
  const open = useARStore((s) => s.open)
  const building = useARStore((s) => s.building)
  const conformer = useARStore((s) => s.conformer)
  const title = useARStore((s) => s.title)
  const close = useARStore((s) => s.close)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sceneRef = useRef<MoleculeScene | null>(null)
  const rafRef = useRef(0)
  const gestureMem = useRef(createGestureMemory())
  const handsRef = useRef<HandsFrame>([])
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const spinRef = useRef(true)
  const view = useRef<ViewState>({ yaw: 0.6, pitch: 0.3, distance: 30, anchorX: 0.5, anchorY: 0.5 })

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackState>('off')
  const [mode, setMode] = useState<DisplayMode>('ball-stick')
  const [showLabels, setShowLabels] = useState(true)
  const [showHydrogens, setShowHydrogens] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [autoSpin, setAutoSpin] = useState(true)
  const [hint, setHint] = useState('Starting camera…')
  const [selected, setSelected] = useState<Atom3D | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [measurePicks, setMeasurePicks] = useState<Atom3D[]>([])
  const [precise3D, setPrecise3DState] = useState(precise3DEnabled)
  const molecules = arMolecules()
  const precise = useARStore((s) => s.precise)

  spinRef.current = autoSpin
  const measuringRef = useRef(false)
  measuringRef.current = measuring

  // ---- camera -----------------------------------------------------------
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const startTracking = async () => {
      setTrack('loading')
      try {
        await initHandTracking()
        if (cancelled) return
        setTrack('on')
        setHint('Show a hand to place the molecule')
      } catch {
        if (cancelled) return
        setTrack('failed')
        setHint('Hand tracking unavailable — drag to rotate')
      }
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser has no camera API.')
        setHint('Drag to rotate · scroll to move closer')
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
            ? 'Camera permission denied — drag to rotate instead.'
            : name === 'NotFoundError'
              ? 'No camera found — drag to rotate instead.'
              : 'Could not start the camera — drag to rotate instead.',
        )
        setHint('Drag to rotate · scroll to move closer')
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

  // ---- scene lifecycle --------------------------------------------------
  useEffect(() => {
    if (!open || !conformer || !canvasRef.current) return
    const scene = new MoleculeScene(canvasRef.current, conformer, {
      mode,
      showHydrogens,
      showLabels,
    })
    sceneRef.current = scene
    view.current.distance = scene.fitDistance()
    view.current.anchorX = 0.5
    view.current.anchorY = 0.5
    setSelected(null)
    setMeasurePicks([])
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
    // Rebuilding on mode/label/H changes is handled by setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conformer])

  useEffect(() => {
    sceneRef.current?.setOptions({ mode, showHydrogens, showLabels })
  }, [mode, showHydrogens, showLabels])

  // ---- render loop ------------------------------------------------------
  useEffect(() => {
    if (!open || !conformer) return
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas || !overlay) return

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop)
      const scene = sceneRef.current
      if (!scene) return

      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      scene.resize(w, h, dpr)
      if (overlay.width !== w * dpr || overlay.height !== h * dpr) {
        overlay.width = w * dpr
        overlay.height = h * dpr
      }

      // Hand tracking drives rotation, depth and position.
      const video = videoRef.current
      if (track === 'on' && video && video.readyState >= 2) {
        const hands = detectHands(video, t)
        handsRef.current = hands
        const g = interpretGestures(hands, gestureMem.current)
        setHintThrottled(g.hint)
        if (g.anchor) {
          view.current.anchorX += (g.anchor.x - view.current.anchorX) * 0.2
          view.current.anchorY += (g.anchor.y - 0.13 - view.current.anchorY) * 0.2
        }
        view.current.yaw += g.dYaw
        view.current.pitch = clamp(view.current.pitch + g.dPitch, -1.45, 1.45)
        if (g.scaleFactor !== 1) {
          view.current.distance = clamp(view.current.distance / g.scaleFactor, 4, 400)
        }
        // Depth: reach toward the camera and the molecule comes with you.
        if (g.depthFactor !== 1) {
          view.current.distance = clamp(view.current.distance * g.depthFactor, 4, 400)
        }
      }

      if (spinRef.current && !dragRef.current) view.current.yaw += 0.006

      // Apply view state to the scene.
      scene.root.rotation.set(view.current.pitch, view.current.yaw, 0)
      const cam = scene.camera
      cam.position.set(0, 0, view.current.distance)
      cam.lookAt(0, 0, 0)
      // Shift the projection so the molecule sits at the anchor point
      // without distorting the perspective.
      cam.setViewOffset(
        w,
        h,
        (0.5 - view.current.anchorX) * w,
        (0.5 - view.current.anchorY) * h,
        w,
        h,
      )
      cam.updateProjectionMatrix()
      scene.render()

      drawOverlay(overlay, dpr, w, h, scene, handsRef.current, showSkeleton, measurePicks, selected)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [open, conformer, track, showSkeleton, measurePicks, selected])

  // Avoid a setState every frame; the hint only changes on gesture changes.
  const lastHint = useRef('')
  const setHintThrottled = (h: string) => {
    if (h !== lastHint.current) {
      lastHint.current = h
      setHint(h)
    }
  }

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (measuringRef.current) {
          setMeasuring(false)
          setMeasurePicks([])
        } else close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const resetView = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    view.current = {
      yaw: 0.6,
      pitch: 0.3,
      distance: scene.fitDistance(),
      anchorX: 0.5,
      anchorY: 0.5,
    }
    setSelected(null)
    setMeasurePicks([])
  }, [])

  /** Save a still of the camera feed plus the molecule. */
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

  // ---- pointer input ----------------------------------------------------
  const pointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false }
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
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    view.current.yaw += dx * 0.01
    view.current.pitch = clamp(view.current.pitch + dy * 0.01, -1.45, 1.45)
    dragRef.current = { x: e.clientX, y: e.clientY, moved: d.moved }
  }
  const pointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved) return
    // A click without drag is a pick.
    const scene = sceneRef.current
    const canvas = canvasRef.current
    if (!scene || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    const hit = scene.pick(ndcX, ndcY)
    if (!hit) {
      setSelected(null)
      return
    }
    if (measuringRef.current) {
      setMeasurePicks((prev) => (prev.length >= 3 ? [hit.atom] : [...prev, hit.atom]))
    } else {
      setSelected(hit.atom)
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    view.current.distance = clamp(view.current.distance * Math.exp(e.deltaY * 0.0012), 4, 400)
  }

  const measureReadout = describeMeasurement(measurePicks)

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
          <div className="text-[15px] font-semibold text-white">{title || 'Molecule'}</div>
          <div className="text-[12px] text-white/70">
            {conformer
              ? `${conformer.atoms.length} atoms · ${MODE_LABEL[mode]}`
              : 'Building 3D structure…'}
          </div>
          {conformer && (
            <div className="text-[11px] text-white/45">
              {precise ? 'measured 3D geometry' : 'idealized geometry'}
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

      {/* status */}
      <div className="pointer-events-none absolute inset-x-0 top-[76px] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] text-white/90 backdrop-blur">
          {(track === 'loading' || building) && <Loader2 size={13} className="animate-spin" />}
          {track === 'on' && !building && <Hand size={13} />}
          <span>{building ? 'Working out the 3D shape…' : (cameraError ?? hint)}</span>
        </div>
      </div>

      {/* molecule switcher */}
      {molecules.length > 1 && (
        <div className="absolute top-[120px] left-4 flex flex-col gap-1.5">
          {molecules.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setARMolecule(m)}
              className={`rounded-[8px] px-2.5 py-1.5 text-left text-[12px] backdrop-blur transition-colors ${
                m.label === title ? 'bg-white text-black' : 'bg-black/55 text-white hover:bg-black/75'
              }`}
            >
              {i + 1}. {m.label}
            </button>
          ))}
        </div>
      )}

      {/* atom inspector — the AR counterpart of the properties panel */}
      {selected && !measuring && (
        <div className="absolute top-[120px] right-4 w-[190px] rounded-[10px] bg-black/60 p-3 text-white backdrop-blur">
          <div className="flex items-baseline justify-between">
            <span className="text-[20px] font-bold">{selected.element}</span>
            <span className="text-[11px] text-white/60">
              {ELEMENTS[selected.element]?.name ?? 'atom'}
            </span>
          </div>
          <dl className="mt-2 space-y-1 text-[12px]">
            <Row k="Atomic number" v={String(ELEMENTS[selected.element]?.z ?? '—')} />
            <Row k="Mass" v={`${ELEMENTS[selected.element]?.mass ?? '—'}`} />
            {selected.charge !== 0 && (
              <Row k="Charge" v={selected.charge > 0 ? `+${selected.charge}` : String(selected.charge)} />
            )}
            <Row k="Kind" v={selected.implicit ? 'added hydrogen' : 'drawn atom'} />
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
              ? 'Tap two atoms for a bond length, three for an angle.'
              : measurePicks.map((a) => a.element).join(' → ')}
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
        {precise
          ? 'Embedded 3D coordinates from the NCI structure service.'
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

/** Bond length for two picks, bond angle for three. */
function describeMeasurement(picks: Atom3D[]): string | null {
  const d = (a: Atom3D, b: Atom3D) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  if (picks.length === 2) return `${d(picks[0], picks[1]).toFixed(2)} Å`
  if (picks.length === 3) {
    const [a, b, c] = picks
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
  measurePicks: Atom3D[],
  selected: Atom3D | null,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const project = (a: Atom3D) => scene.projectToScreen(scene.worldPositionOf(a), w, h)

  // selection ring
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

  // measurement chain
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
