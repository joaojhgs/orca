import { afterEach, expect, it, vi } from 'vitest'
import { admitPtySpawnOwnership } from './spawn-registration'
import { getPtySshConnectionId } from '../provider/registry'
import { deletePtyOwnership } from '../provider/ownership-state'
import { resolveStablePaneOwner } from './stable-owner'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('node-pty', () => ({ spawn: vi.fn(), default: { spawn: vi.fn() } }))
const id = 'ssh:desktop-personal@@pty2:00000000-0000-4000-8000-000000000000:1'
afterEach(() => deletePtyOwnership(id))

it.each([false, true])(
  'keeps SSH authority when admitting a terminal (reattach=%s)',
  (isReattach) => {
    admitPtySpawnOwnership(undefined, { id, isReattach })
    expect(getPtySshConnectionId(id)).toBe('desktop-personal')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this owner lookup calls only the supplied resolveTerminalPane method.
    const runtime = {
      resolveTerminalPane: () => ({
        ptyId: id,
        connected: true,
        handle: 'term_1',
        tabId: 'tab-1',
        leafId: '00000000-0000-4000-8000-000000000001'
      })
    } as unknown as OrcaRuntimeService
    expect(
      resolveStablePaneOwner(
        runtime,
        undefined,
        'tab-1:00000000-0000-4000-8000-000000000001',
        'repo::/project',
        'desktop-personal'
      )
    ).toMatchObject({ ptyId: id, handle: 'term_1' })
    expect(() =>
      resolveStablePaneOwner(
        runtime,
        undefined,
        'tab-1:00000000-0000-4000-8000-000000000001',
        'repo::/project',
        'other-host'
      )
    ).toThrow('terminal_pane_owner_host_mismatch')
  }
)
