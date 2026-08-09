// @ts-expect-error noVNC does not publish TypeScript declarations.
import RfbImplementation from '@novnc/novnc'

export type VncClient = {
  scaleViewport: boolean
  resizeSession: boolean
  viewOnly: boolean
  focusOnClick: boolean
  background: string
  disconnect(): void
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export const RFB = RfbImplementation as new (
  target: HTMLElement,
  url: string,
  options?: { credentials?: { password?: string }; shared?: boolean }
) => VncClient
