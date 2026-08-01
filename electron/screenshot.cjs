const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Captures product screenshots for the showcase site.
 * Usage: electron electron/screenshot.cjs
 * Writes PNGs into ../chemcanvas-site/assets/.
 */

const OUT = path.join(__dirname, '..', '..', 'chemcanvas-site', 'assets')
const SEED = fs.readFileSync(path.join(__dirname, 'seed-doc.json'), 'utf8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function capture(win, name) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name), img.toPNG())
  console.log('captured', name)
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: true,
    backgroundColor: '#0e1015',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // Seed a document + skip the tour, then reload so the app restores it
  await win.webContents.executeJavaScript(
    `localStorage.setItem('chemcanvas:doc:v1', ${JSON.stringify(SEED)});
     localStorage.setItem('chemcanvas:tour-done', '1'); 1`,
  )
  win.webContents.reload()
  await sleep(500)

  // Wait until molecules are rendered (RDKit up + session restored)
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       const t = setInterval(() => {
         if (document.querySelectorAll('main svg [data-atom]').length > 20) {
           clearInterval(t); resolve(1)
         }
       }, 100)
     })`,
  )
  await sleep(400)

  // Frame the drawing (zoom to fit)
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true })); 1`,
  )
  // Let the session-restored toast expire before the hero shot
  await sleep(4200)

  // Shot 1 — the whole app
  await capture(win, 'shot-app.png')

  // Shot 2 — command palette with a SMILES string validating live
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); 1`,
  )
  await sleep(300)
  await win.webContents.executeJavaScript(
    `(() => {
       const input = document.querySelector('[role="dialog"] input')
       if (!input) return 0
       const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
       set.call(input, 'CC(C)Cc1ccc(cc1)C(C)C(=O)O')
       input.dispatchEvent(new Event('input', { bubbles: true }))
       return 1
     })()`,
  )
  await sleep(600)
  await capture(win, 'shot-palette.png')

  // Shot 3 — an atom selected, contextual properties panel
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`,
  )
  await sleep(300)
  await win.webContents.executeJavaScript(
    `(() => {
       const atoms = document.querySelectorAll('main svg [data-atom]')
       const el = atoms[Math.floor(atoms.length / 2)]
       if (!el) return 0
       el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
       return 1
     })()`,
  )
  await sleep(500)
  await capture(win, 'shot-inspector.png')

  // Note: the AR viewer is deliberately not captured here. It requests a
  // camera, and on a build machine without one the capture pipeline stalls
  // waiting on the device. Shoot that screen by hand on a machine with a
  // webcam if a product shot is needed.

  app.quit()
})
