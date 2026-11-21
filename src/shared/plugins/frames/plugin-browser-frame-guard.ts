export const BROWSER_FRAME_GUARD = `
for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
  try { Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false }) } catch {}
}
try { Object.defineProperty(window, 'open', { value: () => null, writable: false, configurable: false }) } catch {}
if (window.navigation) window.navigation.addEventListener('navigate', event => {
  if (event.cancelable) event.preventDefault()
})
`
