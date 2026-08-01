import * as THREE from 'three'
import { cpkColor, vdwRadius } from '../model/elements'
import type { Atom3D, Conformer } from '../chem/conformer'

/**
 * WebGL molecule scene.
 *
 * This replaces an earlier 2D-canvas painter's-algorithm renderer, which
 * could not actually look three-dimensional: it had no perspective divide
 * (so near and far atoms were the same size), its sphere highlight was a
 * fixed gradient that stayed top-left however you turned the molecule, and
 * overlapping sticks and spheres sorted wrongly at the seams.
 *
 * Here atoms and bonds are real geometry lit by real lights, drawn through a
 * perspective camera with a depth buffer, so rotation reads as rotation and
 * the thing in front actually occludes the thing behind.
 */

export type DisplayMode = 'ball-stick' | 'spacefill' | 'wireframe'

export interface SceneOptions {
  mode: DisplayMode
  showHydrogens: boolean
  showLabels: boolean
}

/** Radius used for an atom in a given display mode, in Ångström. */
function atomRadius(el: string, mode: DisplayMode): number {
  if (mode === 'spacefill') return vdwRadius(el)
  if (mode === 'wireframe') return el === 'H' ? 0.08 : 0.11
  return el === 'H' ? 0.23 : 0.30 + (vdwRadius(el) - 1.5) * 0.10
}

export interface PickResult {
  atom: Atom3D
  /** Index into conformer.atoms. */
  index: number
}

export class MoleculeScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  /** Everything that rotates together. */
  readonly root: THREE.Group

  private conformer: Conformer
  private opts: SceneOptions
  private atomMesh: THREE.InstancedMesh | null = null
  private bondMesh: THREE.InstancedMesh | null = null
  private labelSprites: THREE.Sprite[] = []
  private visibleAtoms: { atom: Atom3D; index: number }[] = []
  private ground: THREE.Mesh | null = null
  private disposables: { dispose: () => void }[] = []

  constructor(canvas: HTMLCanvasElement, conformer: Conformer, opts: SceneOptions) {
    this.conformer = conformer
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
    key.shadow.camera.far = 120
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.7)
    fill.position.set(-8, -4, -6)
    this.scene.add(fill)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 0.5))

    this.build()
  }

  /** Rebuild all geometry (after a mode or conformer change). */
  private build() {
    this.teardownGeometry()

    const { mode, showHydrogens } = this.opts
    const atoms = this.conformer.atoms
    this.visibleAtoms = atoms
      .map((atom, index) => ({ atom, index }))
      .filter(({ atom }) => showHydrogens || !atom.implicit)

    // ---- atoms as one instanced sphere mesh ----
    const sphereDetail = atoms.length > 400 ? 1 : atoms.length > 150 ? 2 : 3
    const sphereGeo = new THREE.IcosahedronGeometry(1, sphereDetail)
    const sphereMat = new THREE.MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.02,
    })
    this.disposables.push(sphereGeo, sphereMat)

    const atomMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, this.visibleAtoms.length)
    atomMesh.castShadow = true
    atomMesh.receiveShadow = true
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    this.visibleAtoms.forEach(({ atom }, i) => {
      const r = atomRadius(atom.element, mode)
      m.makeScale(r, r, r)
      m.setPosition(atom.x, atom.y, atom.z)
      atomMesh.setMatrixAt(i, m)
      atomMesh.setColorAt(i, color.set(cpkColor(atom.element)))
    })
    atomMesh.instanceMatrix.needsUpdate = true
    if (atomMesh.instanceColor) atomMesh.instanceColor.needsUpdate = true
    this.root.add(atomMesh)
    this.atomMesh = atomMesh

    // ---- bonds as instanced cylinders, split so each half takes its
    // own atom's color ----
    if (mode !== 'spacefill') {
      const byId = new Map(atoms.map((a) => [a.id, a]))
      const halves: { from: Atom3D; to: Atom3D; color: string }[] = []
      for (const b of this.conformer.bonds) {
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
      const cylMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.02 })
      this.disposables.push(cylGeo, cylMat)

      const bondMesh = new THREE.InstancedMesh(cylGeo, cylMat, halves.length)
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
        bondMesh.setMatrixAt(i, m)
        bondMesh.setColorAt(i, color.set(h.color))
      })
      bondMesh.instanceMatrix.needsUpdate = true
      if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
      this.root.add(bondMesh)
      this.bondMesh = bondMesh
    }

    if (this.opts.showLabels) this.buildLabels()
    this.buildGround()
  }

  /** Element symbols as camera-facing sprites. */
  private buildLabels() {
    // Heteroatoms only, matching how skeletal structures are drawn and what
    // the 2D canvas shows by default: carbon is implied by the vertex, and
    // labelling every C turns a steroid into an unreadable pile of letters.
    const labelled = this.visibleAtoms.filter(
      ({ atom }) => atom.element !== 'H' && atom.element !== 'C',
    )
    if (labelled.length > 120) return // too dense to read anyway
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
      const mat = new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        transparent: true,
      })
      const sprite = new THREE.Sprite(mat)
      const r = atomRadius(atom.element, this.opts.mode)
      sprite.scale.setScalar(Math.max(0.9, r * 2.1))
      sprite.position.set(atom.x, atom.y, atom.z)
      sprite.renderOrder = 10
      this.root.add(sprite)
      this.labelSprites.push(sprite)
      this.disposables.push(tex, mat)
    }
  }

  /**
   * A soft shadow catcher under the molecule. Contact shadow is one of the
   * strongest depth cues there is — it's what makes the model read as
   * sitting in the room rather than pasted onto it.
   */
  private buildGround() {
    const geo = new THREE.PlaneGeometry(400, 400)
    const mat = new THREE.ShadowMaterial({ opacity: 0.32 })
    const plane = new THREE.Mesh(geo, mat)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -this.conformer.radius * 1.6
    plane.receiveShadow = true
    this.scene.add(plane)
    this.ground = plane
    this.disposables.push(geo, mat)
  }

  private teardownGeometry() {
    for (const obj of [this.atomMesh, this.bondMesh]) {
      if (obj) {
        this.root.remove(obj)
        obj.dispose()
      }
    }
    this.atomMesh = null
    this.bondMesh = null
    for (const s of this.labelSprites) this.root.remove(s)
    this.labelSprites = []
    if (this.ground) {
      this.scene.remove(this.ground)
      this.ground = null
    }
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  setOptions(opts: SceneOptions) {
    const changed =
      opts.mode !== this.opts.mode ||
      opts.showHydrogens !== this.opts.showHydrogens ||
      opts.showLabels !== this.opts.showLabels
    this.opts = opts
    if (changed) this.build()
  }

  setConformer(conformer: Conformer) {
    this.conformer = conformer
    this.build()
  }

  resize(width: number, height: number, dpr: number) {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
  }

  /** Distance that frames the whole molecule. */
  fitDistance(): number {
    const fov = (this.camera.fov * Math.PI) / 180
    return (this.conformer.radius * 1.6) / Math.tan(fov / 2)
  }

  /** Ray-pick an atom from normalized device coordinates. */
  pick(ndcX: number, ndcY: number): PickResult | null {
    if (!this.atomMesh) return null
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = raycaster.intersectObject(this.atomMesh, false)
    if (hits.length === 0) return null
    const instanceId = hits[0].instanceId
    if (instanceId === undefined) return null
    const entry = this.visibleAtoms[instanceId]
    return entry ? { atom: entry.atom, index: entry.index } : null
  }

  /** World position of an atom, accounting for the current rotation. */
  worldPositionOf(atom: Atom3D): THREE.Vector3 {
    return this.root.localToWorld(new THREE.Vector3(atom.x, atom.y, atom.z))
  }

  /** Project a world point to screen pixels. */
  projectToScreen(p: THREE.Vector3, width: number, height: number) {
    const v = p.clone().project(this.camera)
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, behind: v.z > 1 }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.teardownGeometry()
    this.renderer.dispose()
  }
}
