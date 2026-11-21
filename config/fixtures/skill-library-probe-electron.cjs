const { app, BrowserWindow } = require('electron')
if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('The renderer probe must remain hidden')
}
app.setPath('userData', process.env.ORCA_LIBRARY_PROBE_PROFILE)
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false }
  })
  await window.loadURL(process.env.ORCA_LIBRARY_PROBE_URL)
})
app.on('window-all-closed', () => app.quit())
