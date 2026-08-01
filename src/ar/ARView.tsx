import {
  Camera,
  Hand,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Tag,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { fitScale, renderConformer, type DisplayMode, type ViewState } from './render3d'

/**
 * Fullscreen AR viewer: live camera behind a 3D ball-and-stick molecule the
 * user manipulates with hand gestures.
 *
 * Degradation is deliberate and layered, because cameras and models fail for
 * ordinary reasons (no device, denied permission, unsupported browser):
 *   camera + hands  → gesture control
 *   camera only     → drag to rotate, molecule over the live feed
 *   neither         → drag to rotate on a plain backdrop
 * The molecule is always usable; hand tracking is an enhancement, never a
 * requirement.
 */

type TrackState = 'off' | 'loading' | 'on' | 'failed'

const MODE_LABEL: Record<DisplayMode, string> = {
  'ball-stick': 'Ball & stick',
  spacefill: 'Space-filling',
  wireframe: 'Wireframe',
}

export default function ARView() {
  const open = useARStore((s) => s.open)
  const conformer = useARStore((s) => s.conformer)
  const title = useARStore((s) => s.title)
  const close = useARStore((s) => s.close)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const viewRef = useRef<ViewState>({ yaw: 0.5, pitch: 0.3, roll: 0, cx: 0, cy: 0, scale: 60 })
  const gestureMem = useRef(createGestureMemory())
  const handsRef = useRef<HandsFrame>([])
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const spinRef = useRef(true)
  const anchorRef = useRef<{ x: number; y: number } | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackState>('off')
  const [mode, setMode] = useState<DisplayMode>('ball-stick')
  const [showLabels, setShowLabels] = useState(true)
  const [showHydrogens, setShowHydrogens] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [autoSpin, setAutoSpin] = useState(true)
  const [hint, setHint] = useState('Starting camera…')

  spinRef.current = autoSpin

  // ---- camera ----------------------------------------------------------
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser has no camera API.')
        setHint('Drag to rotate')
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
            ? 'Camera permission was denied. You can still drag to rotate.'
            : name === 'NotFoundError'
              ? 'No camera found. You can still drag to rotate.'
              : 'Could not start the camera. You can still drag to rotate.',
        )
        setHint('Drag to rotate')
      }
    }

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

  // ---- render loop -----------------------------------------------------
  useEffect(() => {
    if (!open || !conformer) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let first = true
    const loop = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const view = viewRef.current
      if (first) {
        view.cx = w / 2
        view.cy = h / 2
        view.scale = fitScale(conformer, w, h)
        first = false
      }

      // Hand tracking drives position / rotation / scale.
      const video = videoRef.current
      if (track === 'on' && video && video.readyState >= 2) {
        const hands = detectHands(video, t)
        handsRef.current = hands
        const g = interpretGestures(hands, gestureMem.current)
        setHint(g.hint)
        if (g.anchor) {
          anchorRef.current = g.anchor
        } else if (g.mode === 'idle') {
          anchorRef.current = null
        }
        view.yaw += g.dYaw
        view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + g.dPitch))
        if (g.scaleFactor !== 1) {
          view.scale = Math.max(12, Math.min(600, view.scale * g.scaleFactor))
        }
      }

      // Ease the molecule toward the palm so tracking jitter doesn't show.
      const target = anchorRef.current
      const tx = target ? target.x * w : w / 2
      const ty = target ? target.y * h - h * 0.13 : h / 2
      view.cx += (tx - view.cx) * 0.18
      view.cy += (ty - view.cy) * 0.18

      if (spinRef.current && !dragRef.current) view.yaw += 0.006

      renderConformer(ctx, conformer, view, {
        mode,
        showLabels,
        showHydrogens,
        depthCue: true,
      })

      if (showSkeleton && handsRef.current.length > 0) drawSkeleton(ctx, handsRef.current, w, h)

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [open, conformer, track, mode, showLabels, showHydrogens, showSkeleton])

  // ---- keyboard --------------------------------------------------------
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !conformer) return
    anchorRef.current = null
    viewRef.current = {
      yaw: 0.5,
      pitch: 0.3,
      roll: 0,
      cx: canvas.clientWidth / 2,
      cy: canvas.clientHeight / 2,
      scale: fitScale(conformer, canvas.clientWidth, canvas.clientHeight),
    }
  }, [conformer])

  /** Save a still of exactly what's on screen — camera plus molecule. */
  const capture = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas) return
    const out = document.createElement('canvas')
    out.width = canvas.clientWidth
    out.height = canvas.clientHeight
    const c = out.getContext('2d')
    if (!c) return
    if (cameraOn && video && video.readyState >= 2) {
      // Mirror to match the on-screen selfie view.
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

  if (!open || !conformer) return null

  const pointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const pointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const view = viewRef.current
    view.yaw += (e.clientX - d.x) * 0.01
    view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + (e.clientY - d.y) * 0.01))
    dragRef.current = { x: e.clientX, y: e.clientY }
  }
  const pointerUp = () => {
    dragRef.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    const view = viewRef.current
    view.scale = Math.max(12, Math.min(600, view.scale * Math.exp(-e.deltaY * 0.0015)))
  }

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
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 40%, #1c2030, #0b0d12)' }} />
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={onWheel}
      />

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="rounded-[10px] bg-black/55 px-3 py-2 backdrop-blur">
          <div className="text-[15px] font-semibold text-white">{title || 'Molecule'}</div>
          <div className="text-[12px] text-white/70">
            {conformer.atoms.length} atoms · {MODE_LABEL[mode]}
          </div>
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

      {/* status / hint */}
      <div className="pointer-events-none absolute inset-x-0 top-[76px] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] text-white/90 backdrop-blur">
          {track === 'loading' && <Loader2 size={13} className="animate-spin" />}
          {track === 'on' && <Hand size={13} />}
          <span>{cameraError ?? hint}</span>
        </div>
      </div>

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-4">
        <Ctl onClick={() => setMode(mode === 'ball-stick' ? 'spacefill' : mode === 'spacefill' ? 'wireframe' : 'ball-stick')}>
          {MODE_LABEL[mode]}
        </Ctl>
        <Ctl onClick={() => setShowLabels(!showLabels)} active={showLabels}>
          <Tag size={14} /> Labels
        </Ctl>
        <Ctl onClick={() => setShowHydrogens(!showHydrogens)} active={showHydrogens}>
          H atoms
        </Ctl>
        <Ctl onClick={() => setAutoSpin(!autoSpin)} active={autoSpin}>
          {autoSpin ? <Pause size={14} /> : <Play size={14} />} Spin
        </Ctl>
        {track === 'on' && (
          <Ctl onClick={() => setShowSkeleton(!showSkeleton)} active={showSkeleton}>
            <Hand size={14} /> Tracking
          </Ctl>
        )}
        <Ctl onClick={resetView}>
          <RotateCcw size={14} /> Reset
        </Ctl>
        <Ctl onClick={capture}>
          <Camera size={14} /> Photo
        </Ctl>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-[68px] text-center text-[11px] text-white/45">
        Geometry is generated for visualization — idealized angles, not an energy-minimized conformer.
      </p>
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

/** Draw the tracked hand skeleton so users can see tracking is alive. */
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  hands: HandsFrame,
  w: number,
  h: number,
) {
  ctx.save()
  for (const hand of hands) {
    const pts = hand.points.map((p) => ({ x: p.x * w, y: p.y * h }))
    ctx.strokeStyle = hand.pinching ? 'rgba(90,220,140,0.9)' : 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath()
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
      ctx.stroke()
    }
    ctx.fillStyle = hand.pinching ? 'rgba(90,220,140,0.95)' : 'rgba(255,255,255,0.75)'
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}
