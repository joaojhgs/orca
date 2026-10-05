// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DesktopComputerPane } from './desktop-computer-pane'
import { MAIN_DESKTOP, useDesktopStream, type DesktopTarget } from './use-desktop-stream'

const { callRuntimeRpc, clients } = vi.hoisted(() => {
  const clients: {
    viewOnly: boolean
    focusOnClick: boolean
    resizeSession: boolean
    scaleViewport: boolean
    disconnect: ReturnType<typeof vi.fn>
    dispatchEvent: (event: Event) => boolean
    options: unknown
  }[] = []
  return { callRuntimeRpc: vi.fn(), clients }
})
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc,
  hasRuntimeRpcErrorCode: (error: { code?: string }, code: string) => error?.code === code
}))
vi.mock('@/runtime/novnc-rfb', () => ({
  RFB: class extends EventTarget {
    viewOnly = false
    focusOnClick = true
    resizeSession = true
    scaleViewport = false
    background = ''
    disconnect = vi.fn()
    constructor(
      _target: HTMLElement,
      _url: string,
      public options: unknown
    ) {
      super()
      clients.push(this)
    }
  }
}))

const GAME: DesktopTarget = { id: 'k-style-game', label: 'K-style game', viewOnly: true }
const ART: DesktopTarget = { id: 'k-style-art', label: 'K-style art', viewOnly: true }
const ticket = (desktopId = 'main') => ({
  path: '/desktop-vnc?ticket=opaque',
  desktopId,
  viewOnly: desktopId !== 'main'
})

beforeEach(() => {
  clients.length = 0
  callRuntimeRpc.mockReset()
  callRuntimeRpc.mockImplementation(async (_target, method, params) =>
    method === 'status.get'
      ? { capabilities: ['computer.execution-hosts.v1'] }
      : method === 'computer.desktopTargets'
        ? { targets: [MAIN_DESKTOP, GAME, ART] }
        : ticket(params.desktopId)
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderStream(desktop: DesktopTarget = MAIN_DESKTOP) {
  const target = { current: document.createElement('div') }
  return renderHook(
    (props: { desktop: DesktopTarget; active: boolean; attempt: number }) =>
      useDesktopStream(target, props.desktop, props.active, props.attempt),
    { initialProps: { desktop, active: true, attempt: 0 } }
  )
}

describe('desktop stream lifecycle', () => {
  it('accepts an explicitly matched interactive SSH desktop', async () => {
    const remote = { id: 'ssh-vnc:approved', label: 'Personal · Main', viewOnly: false }
    callRuntimeRpc.mockResolvedValue({
      path: '/desktop-vnc?ticket=opaque',
      desktopId: remote.id,
      viewOnly: false
    })
    renderStream(remote)
    await waitFor(() => expect(clients).toHaveLength(1))
    expect(clients[0].viewOnly).toBe(false)
    expect(clients[0].focusOnClick).toBe(true)
  })
  it('preserves interactive main and shares without resizing the desktop', async () => {
    renderStream()
    await waitFor(() => expect(clients).toHaveLength(1))
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'computer.desktopStreamTicket',
      {}
    )
    expect(clients[0]).toMatchObject({
      viewOnly: false,
      focusOnClick: true,
      resizeSession: false,
      scaleViewport: true
    })
    expect(clients[0].options).toEqual({ shared: true })
  })

  it('switches only the viewer connection and passes credentials without storing them', async () => {
    const hook = renderStream()
    await waitFor(() => expect(clients).toHaveLength(1))
    callRuntimeRpc.mockResolvedValue({ ...ticket(GAME.id), credentials: { password: 'test-only' } })
    hook.rerender({ desktop: GAME, active: true, attempt: 0 })
    await waitFor(() => expect(clients).toHaveLength(2))
    expect(clients[0].disconnect).toHaveBeenCalledOnce()
    expect(clients[1]).toMatchObject({ viewOnly: true, focusOnClick: false, resizeSession: false })
    expect(clients[1].options).toEqual({ shared: true, credentials: { password: 'test-only' } })
    expect(
      callRuntimeRpc.mock.calls.every((call) => call[1] === 'computer.desktopStreamTicket')
    ).toBe(true)
    hook.rerender({ desktop: GAME, active: false, attempt: 0 })
    expect(clients[1].disconnect).toHaveBeenCalledOnce()
  })

  it('discards a pending ticket after switching and ignores old viewer events', async () => {
    let resolveOld!: (value: unknown) => void
    callRuntimeRpc.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      })
    )
    const hook = renderStream()
    hook.rerender({ desktop: ART, active: true, attempt: 0 })
    await waitFor(() => expect(clients).toHaveLength(1))
    await act(async () => {
      resolveOld(ticket())
      await Promise.resolve()
    })
    expect(clients).toHaveLength(1)
    act(() => clients[0].dispatchEvent(new Event('connect')))
    expect(hook.result.current.state).toBe('connected')
    hook.unmount()
    expect(clients[0].disconnect).toHaveBeenCalledOnce()
    act(() => clients[0].dispatchEvent(new Event('securityfailure')))
  })

  it('allows legacy main but rejects old hosts silently ignoring another desktop', async () => {
    callRuntimeRpc.mockResolvedValue({ path: '/desktop-vnc?ticket=legacy' })
    const hook = renderStream()
    await waitFor(() => expect(clients).toHaveLength(1))
    hook.rerender({ desktop: GAME, active: true, attempt: 0 })
    await waitFor(() => expect(hook.result.current.error).toMatch(/cannot select/))
    expect(clients).toHaveLength(1)
  })

  it('rejects a mismatched target or redirected stream address', async () => {
    callRuntimeRpc.mockResolvedValue(ticket(ART.id))
    const hook = renderStream(GAME)
    await waitFor(() => expect(hook.result.current.error).toMatch(/cannot select/))
    callRuntimeRpc.mockResolvedValue({ ...ticket(GAME.id), path: '//elsewhere.invalid/stream' })
    hook.rerender({ desktop: GAME, active: true, attempt: 1 })
    await waitFor(() => expect(hook.result.current.error).toMatch(/Invalid desktop stream/))
    expect(clients).toHaveLength(0)
  })

  it('fails visibly on missing credentials and supports reconnect after failure', async () => {
    const hook = renderStream(GAME)
    await waitFor(() => expect(clients).toHaveLength(1))
    act(() => clients[0].dispatchEvent(new Event('credentialsrequired')))
    expect(hook.result.current.error).toMatch(/requires VNC credentials/)
    expect(hook.result.current.state).toBe('disconnected')
    hook.rerender({ desktop: GAME, active: true, attempt: 1 })
    await waitFor(() => expect(clients).toHaveLength(2))
    act(() => clients[1].dispatchEvent(new Event('connect')))
    expect(hook.result.current).toEqual({ state: 'connected', error: null })
  })

  it('never opens a late ticket after timing out', async () => {
    vi.useFakeTimers()
    let resolveTicket!: (value: unknown) => void
    callRuntimeRpc.mockReturnValue(
      new Promise((resolve) => {
        resolveTicket = resolve
      })
    )
    const hook = renderStream()
    act(() => vi.advanceTimersByTime(15_000))
    expect(hook.result.current.error).toMatch(/timed out/)
    await act(async () => {
      resolveTicket(ticket())
      await Promise.resolve()
    })
    expect(clients).toHaveLength(0)
  })
})

describe('desktop selector', () => {
  const renderPane = () =>
    render(
      <TooltipProvider>
        <DesktopComputerPane active />
      </TooltipProvider>
    )

  it('shows configured desktops and marks the game viewer read-only', async () => {
    renderPane()
    await waitFor(() => expect(clients).toHaveLength(1))
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Desktop view' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: GAME.label }))
    await waitFor(() => expect(clients).toHaveLength(2))
    act(() => clients[1].dispatchEvent(new Event('connect')))
    expect(screen.getByRole('status')).toHaveTextContent('View only')
    expect(
      screen.getByText('View only. Agent computer use stays on the main desktop.')
    ).toBeVisible()
    expect(clients[1].viewOnly).toBe(true)
  })

  it('falls back to main only when the listing method is unsupported', async () => {
    callRuntimeRpc.mockRejectedValueOnce({ code: 'method_not_found' })
    renderPane()
    await waitFor(() => expect(clients).toHaveLength(1))
    expect(screen.getByRole('combobox')).toHaveTextContent('Main desktop')
    expect(clients[0].viewOnly).toBe(false)
  })

  it('does not mask authorization/config errors as an old server', async () => {
    callRuntimeRpc.mockRejectedValueOnce({ code: 'forbidden' })
    renderPane()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load desktops')
    expect(clients).toHaveLength(0)
  })
  it('selects the first reachable approved remote desktop when controller has none', async () => {
    const remote = { id: 'ssh-vnc:approved', label: 'Personal · Main', viewOnly: false }
    callRuntimeRpc.mockImplementation(async (_target, method) =>
      method === 'status.get'
        ? { capabilities: ['computer.execution-hosts.v1'] }
        : method === 'computer.desktopTargets'
          ? { targets: [remote] }
          : { path: '/desktop-vnc?ticket=opaque', desktopId: remote.id, viewOnly: false }
    )
    renderPane()
    await waitFor(() => expect(clients).toHaveLength(1))
    expect(screen.getByRole('combobox')).toHaveTextContent(remote.label)
    expect(callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'computer.desktopTargets', {
      executionHosts: true
    })
  })
})
