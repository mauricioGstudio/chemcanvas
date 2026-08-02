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
  /**
   * Fires once, on the frame a single-hand pinch begins — not while it
   * continues. This is the pick point: what's pinched at this instant
   * becomes the focused molecule, so a rotate-drag doesn't also re-pick on
   * every frame.
   */
  pinchStarted: { x: number; y: number } | null
  /** True for every frame a single-hand pinch is held (after the start). */
  pinchActive: boolean
  /**
   * Thumb/index midpoint of the nearest-to-pinching hand, whether or not it
   * is actually pinching. This is where the fingers are *aiming*, which is
   * what the highlight follows so you can see what a pinch would grab before
   * committing to it.
   */
  aim: { x: number; y: number } | null
  /**
   * Hands visible this frame. Two-handed poses are resize gestures, and a
   * stray pinch during one must not be read as "let the molecule go".
   */
  handCount: number
  /** Accumulated rotation deltas this frame, radians. */
  dYaw: number
  dPitch: number
  /** Multiplicative scale change this frame. */
  scaleFactor: number
  /**
   * Depth change this frame, from how much nearer or further the hand is.
   * >1 pushes away, <1 pulls toward the viewer.
   */
  depthFactor: number
  mode: 'idle' | 'rotate' | 'scale'
}

interface GestureMemory {
  lastPinchMid: { x: number; y: number } | null
  lastTwoHandDist: number | null
  /** Hand span last frame — the proxy for distance from the camera. */
  lastSpan: number | null
  /** Was a single hand pinching last frame? Rising edge = pick. */
  wasPinching: boolean
}

export function createGestureMemory(): GestureMemory {
  return { lastPinchMid: null, lastTwoHandDist: null, lastSpan: null, wasPinching: false }
}

/**
 * Turn a frame of hands into interaction deltas.
 *
 * There is deliberately no "open hand" gesture anymore — molecules used to
 * ride along under an open palm, which meant the scene reacted to a hand
 * just being in frame. Now nothing moves until you pinch: a pinch starting
 * on a molecule picks it, and only pinching manipulates anything.
 *
 *   - pinch starting on a molecule → picks it (fires once)
 *   - one pinched hand, held        → drag to rotate
 *   - two pinched hands             → spread/close to scale
 */
export function interpretGestures(hands: HandsFrame, mem: GestureMemory): GestureState {
  const out: GestureState = {
    pinchStarted: null,
    pinchActive: false,
    aim: null,
    handCount: hands.length,
    dYaw: 0,
    dPitch: 0,
    scaleFactor: 1,
    depthFactor: 1,
    mode: 'idle',
  }

  // Aim point, reported every frame regardless of pinch state. With two hands
  // up, the one closest to pinching is the one being aimed — the other is
  // usually just bracing the resize.
  if (hands.length > 0) {
    let best = hands[0]
    for (const h of hands) if (h.pinchStrength < best.pinchStrength) best = h
    out.aim = {
      x: (best.points[THUMB_TIP].x + best.points[INDEX_TIP].x) / 2,
      y: (best.points[THUMB_TIP].y + best.points[INDEX_TIP].y) / 2,
    }
  }

  // Depth from hand span: a hand held closer to the camera covers more of
  // the frame. Tracked on any single visible hand, so moving your hand
  // toward or away from the camera changes depth.
  if (hands.length === 1) {
    const span = hands[0].span
    if (mem.lastSpan !== null && mem.lastSpan > 1e-4) {
      const ratio = span / mem.lastSpan
      // Clamp hard: landmark jitter otherwise reads as violent depth jumps.
      if (ratio > 1.004 || ratio < 0.996) {
        out.depthFactor = Math.max(0.97, Math.min(1.03, 1 / ratio))
      }
    }
    mem.lastSpan = span
  } else {
    mem.lastSpan = null
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
    mem.wasPinching = false
    out.mode = 'scale'
    return out
  }
  mem.lastTwoHandDist = null

  if (pinched.length === 1) {
    const h = pinched[0]
    const mid = {
      x: (h.points[THUMB_TIP].x + h.points[INDEX_TIP].x) / 2,
      y: (h.points[THUMB_TIP].y + h.points[INDEX_TIP].y) / 2,
    }
    if (!mem.wasPinching) {
      // Rising edge: this pinch just started. Report it as a pick and skip
      // rotation for this frame — otherwise the pick point itself reads as
      // a rotation jump.
      out.pinchStarted = mid
    } else if (mem.lastPinchMid) {
      out.dYaw = (mid.x - mem.lastPinchMid.x) * Math.PI * 3
      out.dPitch = (mid.y - mem.lastPinchMid.y) * Math.PI * 3
    }
    out.pinchActive = true
    mem.lastPinchMid = mid
    mem.wasPinching = true
    out.mode = 'rotate'
    return out
  }
  mem.lastPinchMid = null
  mem.wasPinching = false

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
