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
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
      { rx: number; ry: number; scale: number; target: number; z: number }
    >()
    for (const [id, inst] of this.instances) {
      saved.set(id, {
        rx: inst.group.rotation.x,
        ry: inst.group.rotation.y,
        scale: inst.group.scale.x,
        target: inst.targetScale,
        z: inst.group.position.z,
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

      const s = saved.get(entry.id)
      if (s) {
        inst.group.rotation.x = s.rx
        inst.group.rotation.y = s.ry
        inst.group.scale.setScalar(s.scale)
        inst.targetScale = s.target
        inst.group.position.z = s.z
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

  resize(width: number, height: number, dpr: number) {
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

  /** Ray-pick an atom from normalized device coordinates, across every molecule. */
  pick(ndcX: number, ndcY: number): ScenePick | null {
    if (this.instances.size === 0) return null
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const meshes = [...this.instances.values()].map((i) => i.atomMesh)
    const hits = raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    const hitMesh = hits[0].object
    const instanceId = hits[0].instanceId
    if (instanceId === undefined) return null
    for (const inst of this.instances.values()) {
      if (inst.atomMesh === hitMesh) {
        const entry = inst.visibleAtoms[instanceId]
        return entry ? { moleculeId: inst.id, atom: entry.atom, index: entry.index } : null
      }
    }
    return null
  }

  /** Which molecule a ray hits anywhere on its geometry — an atom or a bond. */
  pickMolecule(ndcX: number, ndcY: number): string | null {
    if (this.instances.size === 0) return null
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const meshes: THREE.Object3D[] = []
    for (const inst of this.instances.values()) {
      meshes.push(inst.atomMesh)
      if (inst.bondMesh) meshes.push(inst.bondMesh)
    }
    const hits = raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    for (const inst of this.instances.values()) {
      if (inst.atomMesh === hits[0].object || inst.bondMesh === hits[0].object) return inst.id
    }
    return null
  }

  /**
   * Does this ray pass through a molecule's bounding sphere? Deliberately
   * looser than geometry picking, because it answers a different question:
   * whether a pinch counts as landing *on* the focused molecule. Pinching the
   * empty gap between two of its atoms should not throw the focus away.
   */
  withinBounds(id: string, ndcX: number, ndcY: number): boolean {
    const inst = this.instances.get(id)
    if (!inst) return false
    this.root.updateMatrixWorld(true)
    const center = inst.group.getWorldPosition(new THREE.Vector3())
    const radius = inst.conformer.radius * inst.group.scale.x
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    return raycaster.ray.intersectsSphere(new THREE.Sphere(center, radius))
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

  // A focused molecule deliberately has no way to be translated. It grows and
  // turns where it stands; hand-distance now drives the camera instead, so the
  // structure being read can't drift out from under the reader.

  /** Reset every molecule's manipulation transform back to how it laid out. */
  resetAllTransforms() {
    for (const inst of this.instances.values()) {
      inst.group.rotation.set(0, 0, 0)
      inst.group.scale.setScalar(1)
      inst.targetScale = 1
      inst.group.position.z = 0
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
      radius: inst.conformer.radius,
      opacity: inst.atomMat.opacity,
    }))
  }

  dispose() {
    this.teardownAll()
    this.renderer.dispose()
  }
}
