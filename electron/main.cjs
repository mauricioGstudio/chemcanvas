const { app, BrowserWindow, shell, session } = require('electron')
const path = require('node:path')

/**
 * ChemCanvas desktop shell. The whole app is the built web bundle in dist/;
 * this process only creates the window and smooths over two file://-origin
 * quirks (CORS for the lookup APIs, external links opening in the browser).
 */

// Second launches focus the existing window instead of opening another app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1015', // matches --bg-base dark; no white flash
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // Any external link opens in the user's real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  // Under file:// the page's Origin header is "null"; PubChem/OPSIN CORS
  // replies vary on that. Force-allow responses from just those two hosts,
  // and drop any Set-Cookie they send — the privacy policy promises that
  // nothing persists between lookup requests.
  const filter = {
    urls: ['https://pubchem.ncbi.nlm.nih.gov/*', 'https://opsin.ch.cam.ac.uk/*'],
  }
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders }
    for (const k of Object.keys(headers)) {
      const lower = k.toLowerCase()
      if (lower === 'access-control-allow-origin' || lower === 'set-cookie') delete headers[k]
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders: headers })
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
