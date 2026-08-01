/**
 * Hand tracking for the AR viewer.
 *
 * MediaPipe's hand landmarker runs entirely on-device: the model and wasm
 * are served from this app's own /mediapipe folder, never a CDN, so the
 * privacy promise ("no third-party requests, nothing leaves your computer")
 * still holds. Camera frames are read into the model and discarded; nothing
 * is recorded or transmitted.
 *
 * Everything here is lazily imported so users who never open AR don't pay
 * for the ~19MB of model + wasm.
 */

export interface HandPoint {
  x: number
  y: number
  z: number
}

export interface Hand {
  /** 21 landmarks, normalized 0..1 in image space (x mirrored for selfie view). */
  points: HandPoint[]
  handedness: 'Left' | 'Right'
  /** Distance between thumb tip and index tip, normalized by hand size. */
  pinchStrength: number
  pinching: boolean
  /** Palm center in normalized image space. */
  palm: HandPoint
  /** Rough hand span, used to normalize distances. */
  span: number
}

export type HandsFrame = Hand[]

// Landmark indices from MediaPipe's hand model.
const WRIST = 0
const THUMB_TIP = 4
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const PINKY_MCP = 17

let landmarker: unknown = null
let loading: Promise<unknown> | null = null

/** Load the model once. Throws on failure so the caller can fall back. */
export async function initHandTracking(): Promise<unknown> {
  if (landmarker) return landmarker
  if (loading) return loading

  loading = (async () => {
    const vision = await import('@mediapipe/tasks-vision')
    const fileset = await vision.FilesetResolver.forVisionTasks(
      `${import.meta.env.BASE_URL}mediapipe/wasm`,
    )
    const lm = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    landmarker = lm
    return lm
  })()

  try {
    return await loading
  } catch (err) {
    loading = null
    throw err
  }
}

export function disposeHandTracking() {
  const lm = landmarker as { close?: () => void } | null
  lm?.close?.()
  landmarker = null
  loading = null
}

function dist(a: HandPoint, b: HandPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Read one video frame. `mirrored` matches the flipped selfie view we show
 * the user, so on-screen hand position lines up with the real hand.
 */
export function detectHands(
  video: HTMLVideoElement,
  timestampMs: number,
  mirrored = true,
): HandsFrame {
  const lm = landmarker as {
    detectForVideo?: (v: HTMLVideoElement, t: number) => {
      landmarks?: HandPoint[][]
      handedness?: { categoryName?: string }[][]
      handednesses?: { categoryName?: string }[][]
    }
  } | null
  if (!lm?.detectForVideo) return []

  let res
  try {
    res = lm.detectForVideo(video, timestampMs)
  } catch {
    return []
  }
  const sets = res?.landmarks ?? []
  const handed = res?.handedness ?? res?.handednesses ?? []

  return sets.map((points, i) => {
    const pts = points.map((p) => ({ x: mirrored ? 1 - p.x : p.x, y: p.y, z: p.z }))
    const palm = {
      x: (pts[WRIST].x + pts[MIDDLE_MCP].x + pts[PINKY_MCP].x) / 3,
      y: (pts[WRIST].y + pts[MIDDLE_MCP].y + pts[PINKY_MCP].y) / 3,
      z: (pts[WRIST].z + pts[MIDDLE_MCP].z + pts[PINKY_MCP].z) / 3,
    }
    // Wrist→middle-knuckle is a stable proxy for how close the hand is.
    const span = Math.max(dist(pts[WRIST], pts[MIDDLE_MCP]), 1e-4)
    const pinchDist = dist(pts[THUMB_TIP], pts[INDEX_TIP]) / span
    const raw = handed[i]?.[0]?.categoryName
    return {
      points: pts,
      // MediaPipe labels handedness for the *un*mirrored image; flip it back
      // so "Left" means the user's actual left hand in the mirrored view.
      handedness: (mirrored ? (raw === 'Left' ? 'Right' : 'Left') : raw) === 'Left' ? 'Left' : 'Right',
      pinchStrength: pinchDist,
      pinching: pinchDist < 0.55,
      palm,
      span,
    }
  })
}

export interface GestureState {
  /** Molecule anchor in normalized image space. */
  anchor: { x: number; y: number } | null
  /** Accumulated rotation deltas this frame, radians. */
  dYaw: number
  dPitch: number
  /** Multiplicative scale change this frame. */
  scaleFactor: number
  mode: 'idle' | 'follow' | 'rotate' | 'scale'
  hint: string
}

interface GestureMemory {
  lastPinchMid: { x: number; y: number } | null
  lastTwoHandDist: number | null
}

export function createGestureMemory(): GestureMemory {
  return { lastPinchMid: null, lastTwoHandDist: null }
}

/**
 * Turn a frame of hands into interaction deltas.
 *
 * Gesture vocabulary, chosen so each is distinguishable from the others
 * with a single camera (no depth):
 *   - one open hand      → molecule rides above the palm
 *   - one pinched hand   → drag to rotate
 *   - two pinched hands  → spread/close to scale
 */
export function interpretGestures(
  hands: HandsFrame,
  mem: GestureMemory,
): GestureState {
  const out: GestureState = {
    anchor: null,
    dYaw: 0,
    dPitch: 0,
    scaleFactor: 1,
    mode: 'idle',
    hint: 'Show a hand to place the molecule',
  }

  const pinched = hands.filter((h) => h.pinching)

  if (pinched.length >= 2) {
    const [a, b] = pinched
    const d = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y)
    if (mem.lastTwoHandDist !== null && mem.lastTwoHandDist > 1e-4) {
      out.scaleFactor = Math.max(0.9, Math.min(1.1, d / mem.lastTwoHandDist))
    }
    mem.lastTwoHandDist = d
    mem.lastPinchMid = null
    out.anchor = { x: (a.palm.x + b.palm.x) / 2, y: (a.palm.y + b.palm.y) / 2 }
    out.mode = 'scale'
    out.hint = 'Move hands apart or together to resize'
    return out
  }
  mem.lastTwoHandDist = null

  if (pinched.length === 1) {
    const h = pinched[0]
    const mid = {
      x: (h.points[THUMB_TIP].x + h.points[INDEX_TIP].x) / 2,
      y: (h.points[THUMB_TIP].y + h.points[INDEX_TIP].y) / 2,
    }
    if (mem.lastPinchMid) {
      // Horizontal drag spins around Y, vertical drag tips around X.
      out.dYaw = (mid.x - mem.lastPinchMid.x) * Math.PI * 3
      out.dPitch = (mid.y - mem.lastPinchMid.y) * Math.PI * 3
    }
    mem.lastPinchMid = mid
    out.mode = 'rotate'
    out.hint = 'Pinching — move your hand to rotate'
    return out
  }
  mem.lastPinchMid = null

  if (hands.length > 0) {
    const h = hands[0]
    out.anchor = { x: h.palm.x, y: h.palm.y }
    out.mode = 'follow'
    out.hint = 'Pinch to rotate · use two pinched hands to resize'
    return out
  }

  return out
}

/** Landmark pairs for drawing the hand skeleton overlay. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]
