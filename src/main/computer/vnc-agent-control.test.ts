import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  open: vi.fn(),
  current: vi.fn(),
  init: vi.fn(),
  capture: vi.fn(),
  input: vi.fn()
}))
vi.mock('./desktop-vnc-inventory', () => ({ resolveDesktopVncAccess: mocks.access }))
vi.mock('./ssh-desktop-vnc-route', () => ({
  openDesktopVncRoute: mocks.open,
  isDesktopVncTicketCurrent: mocks.current
}))
vi.mock('./vnc-agent-handshake', () => ({ initializeVncAgent: mocks.init }))
vi.mock('./vnc-agent-framebuffer', () => ({ captureVncAgentFramebuffer: mocks.capture }))
vi.mock('./vnc-agent-input', () => ({ sendVncAgentInput: mocks.input }))
import { performVncAgentAction } from './vnc-agent-control'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue({
    target: { id: 'approved', port: 5901, viewOnly: false },
    password: 'never-serialized'
  })
  mocks.current.mockReturnValue(true)
  mocks.open.mockResolvedValue({ socket: { on: vi.fn(), destroy: vi.fn() }, close: vi.fn() })
  mocks.init.mockResolvedValue({ width: 2, height: 1 })
  mocks.capture.mockResolvedValue('test-image')
})
describe('VNC device proxy authority', () => {
  it('allows viewing but never input for a view-only target', async () => {
    mocks.access.mockResolvedValue({ target: { id: 'approved', port: 5901, viewOnly: true } })
    await expect(performVncAgentAction('approved', { kind: 'screenshot' })).resolves.toMatchObject({
      pngBase64: 'test-image',
      viewOnly: true
    })
    mocks.open.mockClear()
    await expect(performVncAgentAction('approved', { kind: 'key', key: 'A' })).rejects.toThrow(
      /disabled/
    )
    expect(mocks.input).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('rejects an unapproved or disconnected target without local fallback', async () => {
    mocks.access.mockRejectedValue(new Error('not approved'))
    await expect(performVncAgentAction('forged', { kind: 'screenshot' })).rejects.toThrow(
      /not approved/
    )
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('rechecks authority after handshake and does not send stale input', async () => {
    mocks.init.mockImplementation(async () => {
      mocks.current.mockReturnValue(false)
      return { width: 2, height: 1 }
    })
    await expect(performVncAgentAction('approved', { kind: 'key', key: 'A' })).rejects.toThrow(
      /expired/
    )
    expect(mocks.input).not.toHaveBeenCalled()
  })
  it('rechecks authority before returning captured pixels', async () => {
    mocks.capture.mockImplementation(async () => {
      mocks.current.mockReturnValue(false)
      return 'test-image'
    })
    await expect(performVncAgentAction('approved', { kind: 'screenshot' })).rejects.toThrow(
      /expired/
    )
  })
  it('serializes captures and never returns credentials or claims verified input', async () => {
    const reply = await performVncAgentAction('approved', { kind: 'key', key: 'A' })
    expect(reply).toMatchObject({ delivered: true, verification: 'unverified' })
    expect(JSON.stringify(reply)).not.toContain('never-serialized')
    let resolve: (() => void) | undefined
    mocks.capture.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = () => done('pixels')
        })
    )
    const first = performVncAgentAction('approved', { kind: 'screenshot' })
    await vi.waitFor(() => expect(resolve).toBeDefined())
    await expect(performVncAgentAction('approved', { kind: 'screenshot' })).rejects.toThrow(/busy/)
    resolve?.()
    await first
  })
})
