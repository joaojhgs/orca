const { app, BrowserWindow } = require('electron')

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || !process.env.ORCA_VALIDATION_PROFILE) {
  throw new Error('Browser validation requires an isolated profile and background launch')
}
app.setPath('userData', process.env.ORCA_VALIDATION_PROFILE)
app.disableHardwareAcceleration()
let window
app.whenReady().then(() => {
  window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.loadURL('about:blank')
})
