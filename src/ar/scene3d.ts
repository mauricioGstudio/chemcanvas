import * as THREE from 'three'
import { cpkColor, vdwRadius } from '../model/elements'
import type { Atom3D, Conformer } from '../chem/conformer'

/**
 * WebGL scene holding every molecule from the canvas at once, each as its
 * own rigid group laid out left to right. Groups can be manipulated
 * independently — rotated, resized, pulled closer — while the rest of the
 * layout stays put, which is what makes "pinch one to focus it" mean
 * anything: there has to be more than one thing sitting there to pick from.
 *
 * Real geometry lit by real lights through a perspective camera with a
 * depth buffer, rather than a flat 2D painter's-algorithm sketch: rotation
 * reads as rotation, and the thing in front actually occludes what's behind.
 */

export type DisplayMode = 'ball-stick' | 'spacefill' | 'wireframe'

export interface SceneOptions {
  mode: DisplayMode
  showHydrogens: boolean
  showLabels: boolean
}

export interface SceneEntry {
  id: string
  conformer: Conformer
}

export interface ScenePick {
  moleculeId: string
  atom: Atom3D
  index: number
}

/** What kind of thing a pinch is aimed at. */
export type TargetKind = 'molecule' | 'atom' | 'center'

/**
 * Something the fingers are near enough to grab, with where to draw the
 * highlight. Screen fields are CSS pixels so the overlay can use them directly.
 */
export interface SceneTarget {
  kind: TargetKind
  moleculeId: string
  /** Only for kind 'atom'. */
  atom: Atom3D | null
  index: number
  sx: number
  sy: number
  /** Screen radius of the thing itself, for sizing the ring around it. */
  sr: number
}

/**
 * Which things are grabbable right now. Mirrors the three interaction states
 * exactly, so there is one place that decides what a pinch can land on.
 */
export type TargetScope =
  /** Nothing focused — whole molecules. */
  | { kind: 'molecules' }
  /** One molecule focused — its atoms and its centre handle. */
  | { kind: 'within'; moleculeId: string }
  /** Measure mode — atoms on any molecule. */
  | { kind: 'atoms' }

const GAP = 3 // Å between molecule bounding spheres in the layout row
const DIM_OPACITY = 0.28
/**
 * How much bigger a molecule gets when it becomes the focus. It grows where
 * it already stands — the layout position is never touched — so the figure is
 * capped at render time by however much room that spot has left.
 */
const FOCUS_EXPAND = 2.0
/** Scale easing per second: quick enough to feel immediate, slow enough to read as growth. */
const SCALE_EASE = 9

/**
 * How far, in CSS pixels, the fingers can be from something and still grab it.
 * Hand tracking lands within a few pixels at best and the aim point is the
 * midpoint of two moving fingertips, so exact-hit picking is unusable — these
 * are floors, widened further by how big the thing is on screen.
 */
const GRAB_ATOM_MIN_PX = 26
const GRAB_CENTER_PX = 30
/** A molecule can be grabbed slightly outside its silhouette. */
const GRAB_MOLECULE_SLACK = 1.15

const EMPHASIS_HOVER = 0x16233d
const EMPHASIS_ACTIVE = 0x2f52d8

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Scratch objects. Targeting runs every frame over every atom, so nothing in
// that path is allowed to allocate.
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _v4 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()

/** Radius used for an atom in a given display mode, in Ångström. */
function atomRadius(el: string, mode: DisplayMode): number {
  if (mode === 'spacefill') return vdwRadius(el)
  if (mode === 'wireframe') return el === 'H' ? 0.08 : 0.11
  return el === 'H' ? 0.23 : 0.30 + (vdwRadius(el) - 1.5) * 0.10
}

interface Instance {
  id: string
  conformer: Conformer
  /** Positioned at the layout offset; local transform is what focus manipulates. */
  group: THREE.Group
  /** Where the row layout put it. Dragging measures its clamp from here. */
  layoutX: number
  /** Scale the group eases toward — expansion on focus, back to 1 on release. */
  targetScale: number
  atomMat: THREE.MeshStandardMaterial
  bondMat: THREE.MeshStandardMaterial | null
  atomMesh: THREE.InstancedMesh
  bondMesh: THREE.InstancedMesh | null
  labelSprites: THREE.Sprite[]
  visibleAtoms: { atom: Atom3D; index: number }[]
}

export class MoleculeScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  /** Whole-scene group — rotated only when nothing is focused. */
  readonly root: THREE.Group

  private entries: SceneEntry[]
  private opts: SceneOptions
  private instances = new Map<string, Instance>()
  private emphasisHover: string | null = null
  private emphasisActive: string | null = null
  private viewW = 0
  private viewH = 0
  private viewDpr = 0
  private ground: THREE.Mesh | null = null
  private disposables: { dispose: () => void }[] = []
  private overallRadius = 1

  constructor(canvas: HTMLCanvasElement, entries: SceneEntry[], opts: SceneOptions) {
    this.entries = entries
    this.opts = opts

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true, // camera feed shows through
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
    this.camera.position.set(0, 0, 30)

    this.root = new THREE.Group()
    this.scene.add(this.root)

    // Lighting: a key light that casts shadows, a cooler fill from the
    // opposite side, and enough ambient that nothing goes fully black
    // against a bright camera image.
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(6, 10, 8)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 200
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.7)
    fill.position.set(-8, -4, -6)
    this.scene.add(fill)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 0.5))

    this.build()
  }

  /** Rebuild every molecule group, preserving each one's current transform. */
  private build() {
    const saved = new Map<
      string,
      { rx: number; ry: number; scale: number; target: number; dx: number; dy: number; dz: number }
    >()
    for (const [id, inst] of this.instances) {
      saved.set(id, {
        rx: inst.group.rotation.x,
        ry: inst.group.rotation.y,
        scale: inst.group.scale.x,
        target: inst.targetScale,
        // Offsets from the layout slot, so a rebuild that re-lays the row out
        // keeps whatever the user dragged rather than snapping it back.
        dx: inst.group.position.x - inst.layoutX,
        dy: inst.group.position.y,
        dz: inst.group.position.z,
      })
    }
    this.teardownAll()

    // Left-to-right row layout, each molecule's own bounding sphere used so
    // nothing overlaps regardless of size.
    let cursor = 0
    const xFor: number[] = []
    for (const e of this.entries) {
      cursor += e.conformer.radius
      xFor.push(cursor)
      cursor += e.conformer.radius + GAP
    }
    const rowWidth = Math.max(0, cursor - GAP)
    const center = rowWidth / 2

    let maxExtent = 0
    this.entries.forEach((entry, i) => {
      const gx = xFor[i] - center
      maxExtent = Math.max(maxExtent, Math.abs(gx) + entry.conformer.radius)

      const group = new THREE.Group()
      group.position.x = gx
      this.root.add(group)
      const inst = this.buildInstance(entry, group)
      inst.layoutX = gx

      const s = saved.get(entry.id)
      if (s) {
        inst.group.rotation.x = s.rx
        inst.group.rotation.y = s.ry
        inst.group.scale.setScalar(s.scale)
        inst.targetScale = s.target
        inst.group.position.set(gx + s.dx, s.dy, s.dz)
      }
      this.instances.set(entry.id, inst)
    })
    this.overallRadius = Math.max(1, maxExtent)

    this.buildGround()
  }

  private buildInstance(entry: SceneEntry, group: THREE.Group): Instance {
    const { mode, showHydrogens } = this.opts
    const conformer = entry.conformer
    const atoms = conformer.atoms
    const visibleAtoms = atoms
      .map((atom, index) => ({ atom, index }))
      .filter(({ atom }) => showHydrogens || !atom.implicit)

    const sphereDetail = atoms.length > 400 ? 1 : atoms.length > 150 ? 2 : 3
    const sphereGeo = new THREE.IcosahedronGeometry(1, sphereDetail)
    const atomMat = new THREE.MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.02,
      transparent: true,
    })
    this.disposables.push(sphereGeo, atomMat)

    const atomMesh = new THREE.InstancedMesh(sphereGeo, atomMat, visibleAtoms.length)
    atomMesh.castShadow = true
    atomMesh.receiveShadow = true
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    visibleAtoms.forEach(({ atom }, i) => {
      const r = atomRadius(atom.element, mode)
      m.makeScale(r, r, r)
      m.setPosition(atom.x, atom.y, atom.z)
      atomMesh.setMatrixAt(i, m)
      atomMesh.setColorAt(i, color.set(cpkColor(atom.element)))
    })
    atomMesh.instanceMatrix.needsUpdate = true
    if (atomMesh.instanceColor) atomMesh.instanceColor.needsUpdate = true
    group.add(atomMesh)

    let bondMesh: THREE.InstancedMesh | null = null
    let bondMat: THREE.MeshStandardMaterial | null = null
    if (mode !== 'spacefill') {
      const byId = new Map(atoms.map((a) => [a.id, a]))
      const halves: { from: Atom3D; to: Atom3D; color: string }[] = []
      for (const b of conformer.bonds) {
        const a1 = byId.get(b.a1)
        const a2 = byId.get(b.a2)
        if (!a1 || !a2) continue
        if (!showHydrogens && (a1.implicit || a2.implicit)) continue
        const mid = {
          id: 'mid',
          element: a1.element,
          x: (a1.x + a2.x) / 2,
          y: (a1.y + a2.y) / 2,
          z: (a1.z + a2.z) / 2,
          charge: 0,
          implicit: false,
        }
        halves.push({ from: a1, to: mid, color: cpkColor(a1.element) })
        halves.push({ from: a2, to: mid, color: cpkColor(a2.element) })
      }

      const radius = mode === 'wireframe' ? 0.045 : 0.105
      const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, 12, 1, true)
      bondMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.02, transparent: true })
      this.disposables.push(cylGeo, bondMat)

      bondMesh = new THREE.InstancedMesh(cylGeo, bondMat, halves.length)
      bondMesh.castShadow = true
      const up = new THREE.Vector3(0, 1, 0)
      const dir = new THREE.Vector3()
      const midPoint = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      const scaleV = new THREE.Vector3()
      halves.forEach((h, i) => {
        dir.set(h.to.x - h.from.x, h.to.y - h.from.y, h.to.z - h.from.z)
        const length = dir.length() || 1e-4
        midPoint.set((h.from.x + h.to.x) / 2, (h.from.y + h.to.y) / 2, (h.from.z + h.to.z) / 2)
        quat.setFromUnitVectors(up, dir.clone().normalize())
        scaleV.set(1, length, 1)
        m.compose(midPoint, quat, scaleV)
        bondMesh!.setMatrixAt(i, m)
        bondMesh!.setColorAt(i, color.set(h.color))
      })
      bondMesh.instanceMatrix.needsUpdate = true
      if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
      group.add(bondMesh)
    }

    const labelSprites: THREE.Sprite[] = []
    if (this.opts.showLabels) {
      // Heteroatoms only, matching skeletal-structure convention: carbon is
      // implied by the vertex, and labelling every C is unreadable on a
      // steroid-sized structure.
      const labelled = visibleAtoms.filter(({ atom }) => atom.element !== 'H' && atom.element !== 'C')
      if (labelled.length <= 120) {
        for (const { atom } of labelled) {
          const canvas = document.createElement('canvas')
          canvas.width = 128
          canvas.height = 128
          const ctx = canvas.getContext('2d')!
          ctx.font = 'bold 76px Inter, system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.lineWidth = 10
          ctx.strokeStyle = 'rgba(0,0,0,0.85)'
          ctx.strokeText(atom.element, 64, 68)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(atom.element, 64, 68)

          const tex = new THREE.CanvasTexture(canvas)
          tex.colorSpace = THREE.SRGBColorSpace
          const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
          const sprite = new THREE.Sprite(mat)
          const r = atomRadius(atom.element, mode)
          sprite.scale.setScalar(Math.max(0.9, r * 2.1))
          sprite.position.set(atom.x, atom.y, atom.z)
          sprite.renderOrder = 10
          group.add(sprite)
          labelSprites.push(sprite)
          this.disposables.push(tex, mat)
        }
      }
    }

    return {
      id: entry.id,
      conformer,
      group,
      layoutX: group.position.x,
      targetScale: 1,
      atomMat,
      bondMat,
      atomMesh,
      bondMesh,
      labelSprites,
      visibleAtoms,
    }
  }

  /**
   * A soft shadow catcher under the whole row. Contact shadow is one of the
   * strongest depth cues there is — it's what makes the layout read as
   * sitting in the room rather than pasted onto it.
   */
  private buildGround() {
    const geo = new THREE.PlaneGeometry(600, 600)
    const mat = new THREE.ShadowMaterial({ opacity: 0.32 })
    const plane = new THREE.Mesh(geo, mat)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -this.overallRadius * 1.6
    plane.receiveShadow = true
    this.scene.add(plane)
    this.ground = plane
    this.disposables.push(geo, mat)
  }

  private teardownAll() {
    for (const inst of this.instances.values()) {
      this.root.remove(inst.group)
      inst.atomMesh.dispose()
      inst.bondMesh?.dispose()
    }
    this.instances.clear()
    if (this.ground) {
      this.scene.remove(this.ground)
      this.ground = null
    }
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  /** Swap in updated conformers (e.g. a precise-3D upgrade) without losing focus/transform. */
  setEntries(entries: SceneEntry[]) {
    this.entries = entries
    this.build()
  }

  setOptions(opts: SceneOptions) {
    const changed =
      opts.mode !== this.opts.mode ||
      opts.showHydrogens !== this.opts.showHydrogens ||
      opts.showLabels !== this.opts.showLabels
    this.opts = opts
    if (changed) this.build()
  }

  /** No-op when nothing changed — this is called every frame from the render loop. */
  resize(width: number, height: number, dpr: number) {
    if (width === this.viewW && height === this.viewH && dpr === this.viewDpr) return
    this.viewW = width
    this.viewH = height
    this.viewDpr = dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
  }

  /** Camera distance that frames the whole laid-out row. */
  fitDistance(): number {
    const fov = (this.camera.fov * Math.PI) / 180
    return (this.overallRadius * 1.6) / Math.tan(fov / 2)
  }

  /**
   * Bring world matrices up to date. Called once a frame before targeting, so
   * hover reflects this frame's transforms rather than last frame's. Not
   * forced — three only recomputes branches whose local matrix changed, and
   * the render immediately after then finds nothing left to do.
   */
  syncMatrices() {
    this.camera.updateMatrixWorld()
    this.root.updateMatrixWorld()
  }

  /** Project a world point held in `_v1` to CSS pixels. Returns depth for tie-breaks. */
  private projectScratch(w: number, h: number) {
    _v1.project(this.camera)
    return {
      x: ((_v1.x + 1) / 2) * w,
      y: ((1 - _v1.y) / 2) * h,
      behind: _v1.z > 1,
    }
  }

  /** Pixels-per-world-unit at a given world point, for sizing screen radii. */
  private pixelScaleAt(worldX: number, worldY: number, worldZ: number, h: number): number {
    const fov = (this.camera.fov * Math.PI) / 180
    const dist = Math.max(
      this.camera.position.distanceTo(_v4.set(worldX, worldY, worldZ)),
      0.01,
    )
    return h / (2 * Math.tan(fov / 2) * dist)
  }

  /**
   * What a pinch aimed at this point would grab, or null if it would grab
   * nothing.
   *
   * Proximity in screen space, not ray hits. Fingers are aimed roughly and the
   * aim point is the midpoint of two moving fingertips, so a highlight that
   * only appears when you are exactly over an atom is unusable in practice.
   * Everything is scored as distance ÷ its own grab radius, so a small atom
   * right under the fingers beats a fat one further away, and near-ties are
   * broken by whichever is closer to the camera — otherwise a back atom
   * showing through the middle of a ring steals the pick from the front one.
   */
  targetAt(ndcX: number, ndcY: number, w: number, h: number, scope: TargetScope): SceneTarget | null {
    if (this.instances.size === 0) return null
    const px = ((ndcX + 1) / 2) * w
    const py = ((1 - ndcY) / 2) * h

    let bestScore = Infinity
    let bestDepth = Infinity
    let best: SceneTarget | null = null

    const consider = (t: SceneTarget, dist: number, grab: number, camDist: number) => {
      if (dist > grab) return
      const score = dist / grab
      // Bucketed so "about as close" ties resolve by depth instead of by a
      // sub-pixel difference in finger position.
      const bucket = Math.round(score * 4)
      const bestBucket = Math.round(bestScore * 4)
      if (bucket < bestBucket || (bucket === bestBucket && camDist < bestDepth)) {
        bestScore = score
        bestDepth = camDist
        best = t
      }
    }

    const considerAtomsOf = (inst: Instance) => {
      const m = inst.group.matrixWorld
      const scale = inst.group.scale.x
      for (let i = 0; i < inst.visibleAtoms.length; i++) {
        const a = inst.visibleAtoms[i].atom
        _v1.set(a.x, a.y, a.z).applyMatrix4(m)
        const wx = _v1.x
        const wy = _v1.y
        const wz = _v1.z
        const camDist = this.camera.position.distanceTo(_v2.set(wx, wy, wz))
        const s = this.projectScratch(w, h)
        if (s.behind) continue
        const rPx = atomRadius(a.element, this.opts.mode) * scale * this.pixelScaleAt(wx, wy, wz, h)
        const dist = Math.hypot(s.x - px, s.y - py)
        consider(
          {
            kind: 'atom',
            moleculeId: inst.id,
            atom: a,
            index: inst.visibleAtoms[i].index,
            sx: s.x,
            sy: s.y,
            sr: Math.max(rPx, 4),
          },
          dist,
          Math.max(rPx * 1.5, GRAB_ATOM_MIN_PX),
          camDist,
        )
      }
    }

    if (scope.kind === 'molecules') {
      for (const inst of this.instances.values()) {
        _v1.setFromMatrixPosition(inst.group.matrixWorld)
        const wx = _v1.x
        const wy = _v1.y
        const wz = _v1.z
        const camDist = this.camera.position.distanceTo(_v2.set(wx, wy, wz))
        const s = this.projectScratch(w, h)
        if (s.behind) continue
        const rPx =
          inst.conformer.radius * inst.group.scale.x * this.pixelScaleAt(wx, wy, wz, h)
        const dist = Math.hypot(s.x - px, s.y - py)
        consider(
          { kind: 'molecule', moleculeId: inst.id, atom: null, index: -1, sx: s.x, sy: s.y, sr: rPx },
          dist,
          Math.max(rPx * GRAB_MOLECULE_SLACK, GRAB_ATOM_MIN_PX),
          camDist,
        )
      }
      return best
    }

    if (scope.kind === 'atoms') {
      for (const inst of this.instances.values()) considerAtomsOf(inst)
      return best
    }

    const inst = this.instances.get(scope.moleculeId)
    if (!inst) return null
    considerAtomsOf(inst)

    // The centre handle competes with the atoms rather than overriding them,
    // so an atom sitting on top of the centre is still reachable.
    _v1.setFromMatrixPosition(inst.group.matrixWorld)
    const camDist = this.camera.position.distanceTo(_v2.copy(_v1))
    const s = this.projectScratch(w, h)
    if (!s.behind) {
      const dist = Math.hypot(s.x - px, s.y - py)
      consider(
        { kind: 'center', moleculeId: inst.id, atom: null, index: -1, sx: s.x, sy: s.y, sr: 13 },
        dist,
        GRAB_CENTER_PX,
        camDist,
      )
    }
    return best
  }

  /** Where to draw a molecule's centre handle, in CSS pixels. */
  centerHandleScreen(id: string, w: number, h: number): { x: number; y: number; behind: boolean } | null {
    const inst = this.instances.get(id)
    if (!inst) return null
    _v1.setFromMatrixPosition(inst.group.matrixWorld)
    return this.projectScratch(w, h)
  }

  /**
   * Is a screen point over a molecule at all? Looser than targeting, because
   * it answers a different question: whether a pinch counts as landing *on*
   * the focused molecule. Pinching the empty gap between two of its atoms
   * should not throw the focus away.
   */
  withinBounds(id: string, ndcX: number, ndcY: number, w: number, h: number): boolean {
    const inst = this.instances.get(id)
    if (!inst) return false
    const px = ((ndcX + 1) / 2) * w
    const py = ((1 - ndcY) / 2) * h
    _v1.setFromMatrixPosition(inst.group.matrixWorld)
    const wx = _v1.x
    const wy = _v1.y
    const wz = _v1.z
    const s = this.projectScratch(w, h)
    if (s.behind) return false
    const rPx = inst.conformer.radius * inst.group.scale.x * this.pixelScaleAt(wx, wy, wz, h)
    return Math.hypot(s.x - px, s.y - py) <= Math.max(rPx, GRAB_ATOM_MIN_PX)
  }

  /**
   * Tint the hovered and grabbed molecules. Early-outs when nothing changed,
   * because this is called every frame.
   */
  setMoleculeEmphasis(hoverId: string | null, activeId: string | null) {
    if (hoverId === this.emphasisHover && activeId === this.emphasisActive) return
    this.emphasisHover = hoverId
    this.emphasisActive = activeId
    for (const [id, inst] of this.instances) {
      const c = id === activeId ? EMPHASIS_ACTIVE : id === hoverId ? EMPHASIS_HOVER : 0x000000
      inst.atomMat.emissive.setHex(c)
      inst.bondMat?.emissive.setHex(c)
    }
  }

  /**
   * Scale that makes one molecule read as the subject of the view.
   *
   * Capped so it still fits the frame from wherever it happens to sit: the
   * layout position is never changed to make room, so a molecule far out to
   * one side has less to grow into than one near the middle.
   */
  focusScaleFor(id: string, cameraDistance: number): number {
    const inst = this.instances.get(id)
    if (!inst) return 1
    const fov = (this.camera.fov * Math.PI) / 180
    const halfH = Math.tan(fov / 2) * Math.max(cameraDistance, 1)
    const halfW = halfH * Math.max(this.camera.aspect, 0.1)
    const r = Math.max(inst.conformer.radius, 0.1)
    const room = Math.max(halfW - Math.abs(inst.group.position.x), r)
    const fit = Math.min(room / r, (halfH * 0.9) / r)
    return clamp(Math.min(FOCUS_EXPAND, fit), 1, 4)
  }

  /** Grow the focused molecule in place; return every other one to its laid-out size. */
  setFocusExpansion(focusedId: string | null, cameraDistance: number) {
    for (const [id, inst] of this.instances) {
      inst.targetScale = id === focusedId ? this.focusScaleFor(id, cameraDistance) : 1
    }
  }

  /** Ease every group toward its target scale. Call once per frame. */
  update(dt: number) {
    const k = 1 - Math.exp(-SCALE_EASE * Math.min(Math.max(dt, 0), 0.1))
    for (const inst of this.instances.values()) {
      const s = inst.group.scale.x
      if (s === inst.targetScale) continue
      const next = Math.abs(inst.targetScale - s) < 1e-4 ? inst.targetScale : s + (inst.targetScale - s) * k
      inst.group.scale.setScalar(next)
    }
  }

  /** Dim every molecule except the focused one; pass null to bring all back to full opacity. */
  setFocusHighlight(focusedId: string | null) {
    for (const [id, inst] of this.instances) {
      const on = focusedId === null || id === focusedId
      const op = on ? 1 : DIM_OPACITY
      inst.atomMat.opacity = op
      if (inst.bondMat) inst.bondMat.opacity = op
      for (const s of inst.labelSprites) (s.material as THREE.SpriteMaterial).opacity = op
    }
  }

  /** Rotate one molecule about its own center, incrementally. */
  rotateInstance(id: string, dYaw: number, dPitch: number) {
    const inst = this.instances.get(id)
    if (!inst) return
    inst.group.rotation.y += dYaw
    inst.group.rotation.x = clamp(inst.group.rotation.x + dPitch, -1.6, 1.6)
  }

  /**
   * Scale one molecule up or down, multiplicatively, clamped to a sane range.
   * Moves the target rather than the group directly, so a resize on top of an
   * in-flight focus expansion blends instead of fighting it.
   */
  scaleInstance(id: string, factor: number) {
    const inst = this.instances.get(id)
    if (!inst) return
    inst.targetScale = clamp(inst.targetScale * factor, 0.3, 4)
  }

  /**
   * Slide one molecule parallel to the screen, by a delta in CSS pixels.
   *
   * This is the only way a molecule can be moved, and it only happens while
   * the centre handle is held — hand distance drives the camera, never the
   * molecule, so nothing drifts just because a hand did. Working in pixels
   * means it tracks the fingers at any distance, and the delta is rotated out
   * of world space into the row's frame because that is where positions live.
   */
  translateInstance(id: string, dxPx: number, dyPx: number, viewportH: number) {
    const inst = this.instances.get(id)
    if (!inst) return
    _v1.setFromMatrixPosition(inst.group.matrixWorld)
    const perPx = 1 / this.pixelScaleAt(_v1.x, _v1.y, _v1.z, viewportH)

    const right = _v2.setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = _v3.setFromMatrixColumn(this.camera.matrixWorld, 1)
    const delta = _v4
      .set(0, 0, 0)
      .addScaledVector(right, dxPx * perPx)
      .addScaledVector(up, -dyPx * perPx)
    delta.applyQuaternion(_q1.copy(this.root.quaternion).invert())

    const span = Math.max(this.overallRadius, 4) * 1.5
    const p = inst.group.position
    p.x = clamp(p.x + delta.x, inst.layoutX - span, inst.layoutX + span)
    p.y = clamp(p.y + delta.y, -span, span)
    p.z = clamp(p.z + delta.z, -span, span)
  }

  /** Reset every molecule's manipulation transform back to how it laid out. */
  resetAllTransforms() {
    for (const inst of this.instances.values()) {
      inst.group.rotation.set(0, 0, 0)
      inst.group.scale.setScalar(1)
      inst.targetScale = 1
      inst.group.position.set(inst.layoutX, 0, 0)
    }
  }

  /** World position of an atom belonging to a specific molecule. */
  worldPositionOf(moleculeId: string, atom: Atom3D): THREE.Vector3 {
    const inst = this.instances.get(moleculeId)
    if (!inst) return new THREE.Vector3()
    return inst.group.localToWorld(new THREE.Vector3(atom.x, atom.y, atom.z))
  }

  /** Project a world point to screen pixels. */
  projectToScreen(p: THREE.Vector3, width: number, height: number) {
    const v = p.clone().project(this.camera)
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, behind: v.z > 1 }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  /** Snapshot of every molecule's current layout and manipulation transform. */
  debugInstances() {
    return [...this.instances.entries()].map(([id, inst]) => ({
      id,
      x: inst.group.position.x,
      y: inst.group.position.y,
      z: inst.group.position.z,
      rotX: inst.group.rotation.x,
      rotY: inst.group.rotation.y,
      scale: inst.group.scale.x,
      targetScale: inst.targetScale,
      layoutX: inst.layoutX,
      radius: inst.conformer.radius,
      opacity: inst.atomMat.opacity,
      emissive: inst.atomMat.emissive.getHex(),
    }))
  }

  dispose() {
    this.teardownAll()
    this.renderer.dispose()
  }
}
