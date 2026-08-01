const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Renders the WebGL molecule scene and saves a PNG. Run against the dev
 * server (npm run dev) so the TypeScript modules resolve:
 *   electron electron/shot3d.cjs
 *
 * Exists because the AR view itself needs a camera, which build machines
 * don't have — this captures the same renderer without one.
 */

const OUT = path.join(__dirname, '..', '..', 'chemcanvas-site', 'assets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    backgroundColor: '#11131a',
    webPreferences: { offscreen: false },
  })

  await win.loadURL('http://localhost:5173')
  await sleep(3500)

  const built = await win.webContents.executeJavaScript(`
    (async () => {
      const [conf, s3, props, graph] = await Promise.all([
        import('/src/chem/conformer.ts'), import('/src/ar/scene3d.ts'),
        import('/src/chem/properties.ts'), import('/src/model/graph.ts')])
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:#11131a;display:grid;' +
        'grid-template-columns:1fr 1fr;place-items:center'
      document.body.appendChild(host)
      window.__keep = []
      const draw = (smiles, mode, label) => {
        const mb = props.molblockFromSmiles(smiles)
        const mol = graph.moleculeFromMolblock(mb, {x:0,y:0}, props.implicitHsForMolblock(mb))
        const c = conf.generateConformer(mol)
        const wrap = document.createElement('div')
        wrap.style.cssText = 'text-align:center;color:#fff;font:12px system-ui'
        const cv = document.createElement('canvas')
        cv.width = 460; cv.height = 310
        cv.style.cssText = 'width:460px;height:310px'
        wrap.appendChild(cv)
        const cap = document.createElement('div')
        cap.textContent = label
        wrap.appendChild(cap)
        host.appendChild(wrap)
        const scene = new s3.MoleculeScene(cv, c, {
          mode, showHydrogens: true, showLabels: mode !== 'spacefill',
        })
        scene.resize(460, 310, 2)
        scene.camera.position.set(0, 0, scene.fitDistance())
        scene.camera.lookAt(0, 0, 0)
        scene.root.rotation.set(0.35, 0.7, 0)
        scene.render()
        window.__keep.push(scene)
      }
      draw('Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'ball-stick', 'caffeine')
      draw('C1CCCCC1', 'ball-stick', 'cyclohexane (chair)')
      draw('Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'spacefill', 'caffeine (space-filling)')
      draw('CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C', 'ball-stick', 'cholesterol')
      return window.__keep.length
    })()
  `)
  console.log('scenes built:', built)

  await sleep(1500)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, 'shot-3d.png'), img.toPNG())
  console.log('captured shot-3d.png')
  app.quit()
})
