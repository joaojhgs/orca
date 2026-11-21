export const TARGETLESS_BROWSER_METHODS: Record<string, true> = {
  browserProfileClearGoogleCookies: true,
  browserProfileClearDefaultCookies: true,
  browserProfileCreate: true,
  browserProfileDelete: true,
  browserProfileDetectBrowsers: true,
  browserProfileImportFromBrowser: true,
  browserProfileList: true,
  browserTabCreate: true,
  browserTabList: true
}

// RPC names that don't follow from the command name.
const RUNTIME_METHOD_NAMES: Record<string, string> = {
  browserOpenUrlOnClient: 'browser.openUrl',
  browserProceedCertificate: 'browser.certificate.proceed',
  browserSetViewport: 'browser.viewport',
  browserSetGeolocation: 'browser.geolocation',
  browserConsoleLog: 'browser.console',
  browserNetworkLog: 'browser.network',
  browserGrabSetMode: 'browser.grab.setMode',
  browserGrabAwait: 'browser.grab.await',
  browserGrabCancel: 'browser.grab.cancel',
  browserGrabCaptureSelection: 'browser.grab.captureSelection',
  browserGrabExtractHover: 'browser.grab.extractHover',
  browserGrabViewportBridge: 'browser.grab.viewportBridge',
  browserGrabWatch: 'browser.grab.watch',
  browserSetGrabMode: 'browser.grab.setMode',
  browserAwaitGrabSelection: 'browser.grab.awaitSelection',
  browserCancelGrab: 'browser.grab.cancel',
  browserCaptureSelectionScreenshot: 'browser.grab.captureScreenshot'
}

export function electronSidecarRuntimeMethodName(browserMethod: string): string {
  const named = RUNTIME_METHOD_NAMES[browserMethod]
  if (named) {
    return named
  }
  const suffix = browserMethod.slice('browser'.length)
  for (const group of ['Cookie', 'Intercept', 'Capture'] as const) {
    if (suffix.startsWith(group)) {
      const action = suffix.slice(group.length)
      return `browser.${group.toLowerCase()}.${action[0].toLowerCase()}${action.slice(1)}`
    }
  }
  for (const storage of ['StorageLocal', 'StorageSession'] as const) {
    if (suffix.startsWith(storage)) {
      const action = suffix.slice(storage.length)
      const area = storage === 'StorageLocal' ? 'local' : 'session'
      return `browser.storage.${area}.${action[0].toLowerCase()}${action.slice(1)}`
    }
  }
  return `browser.${suffix[0].toLowerCase()}${suffix.slice(1)}`
}
