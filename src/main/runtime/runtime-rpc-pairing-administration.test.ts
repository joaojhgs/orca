import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { loadOrCreateE2EEKeypair } from './e2ee-keypair'
import { RpcDispatcher } from './rpc/dispatcher'
import { PAIRING_ADMINISTRATION_METHODS } from './rpc/methods/pairing-administration'

const responseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional()
})
const directories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-pairing-admin-'))
  directories.push(directory)
  const runtime = new OrcaRuntimeService()
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: directory,
    advertisedPairingAddress: 'wss://orca.example.com'
  })
  const registry = new DeviceRegistry(directory)
  server['deviceRegistry'] = registry
  server['e2eeKeypair'] = loadOrCreateE2EEKeypair(directory)
  vi.spyOn(server, 'getWebSocketEndpoint').mockReturnValue('ws://127.0.0.1:6768')
  vi.spyOn(server, 'ensureNetworkExposure').mockResolvedValue(undefined)
  const owner = registry.addDevice('Browser', 'runtime')
  const mobile = registry.addDevice('Phone', 'mobile')
  async function call(method: string, token: string, params?: unknown) {
    const replies: string[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'admin-request', deviceToken: token, method, params }),
      (reply) => replies.push(reply),
      () => {},
      undefined,
      undefined,
      token
    )
    return responseSchema.parse(JSON.parse(replies[0]))
  }
  return { runtime, server, registry, owner, mobile, call }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('browser pairing administration', () => {
  it('publishes the configured server address and actual listener readiness', async () => {
    const { call, owner, server } = fixture()
    expect(await call('pairing.admin.listNetworkInterfaces', owner.token)).toMatchObject({
      ok: true,
      result: {
        interfaces: [{ name: 'Server address', address: 'wss://orca.example.com' }]
      }
    })
    expect(await call('pairing.admin.isWebSocketReady', owner.token)).toMatchObject({
      ok: true,
      result: { ready: true, endpoint: 'wss://orca.example.com' }
    })
    vi.mocked(server.getWebSocketEndpoint).mockReturnValue(null)
    expect(await call('pairing.admin.isWebSocketReady', owner.token)).toMatchObject({
      result: { ready: false }
    })
  })

  it('mints a real mobile-scoped QR over the public endpoint without cloud', async () => {
    const { call, owner, registry } = fixture()
    const response = await call('pairing.admin.getPairingQR', owner.token, {
      connectionMode: 'local-only'
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        available: true,
        endpoint: 'wss://orca.example.com',
        connectionMode: 'local-only',
        qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/)
      }
    })
    expect(registry.getPendingDevice('mobile')?.scope).toBe('mobile')
    expect(registry.listDevices().filter((device) => device.scope === 'runtime')).toHaveLength(1)
  })

  it('rejects mobile credentials and invalid tokens before administrative dispatch', async () => {
    const { call, mobile } = fixture()
    for (const method of PAIRING_ADMINISTRATION_METHODS) {
      expect(await call(method.name, mobile.token)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' }
      })
      expect(await call(method.name, 'not-a-token')).toMatchObject({
        ok: false,
        error: { code: 'unauthorized' }
      })
    }
  })

  it('rejects scope/identity injection and refuses silent Relay downgrades', async () => {
    const { call, owner, registry, mobile } = fixture()
    const before = registry.listDevices().length
    for (const injected of [{ scope: 'runtime' }, { deviceToken: 'injected' }, { deviceId: 'x' }]) {
      expect(
        await call('pairing.admin.getPairingQR', owner.token, {
          connectionMode: 'local-only',
          ...injected
        })
      ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    expect(registry.getPendingDevice('mobile')?.deviceId).toBe(mobile.deviceId)
    expect(registry.listDevices()).toHaveLength(before)
    expect(
      await call('pairing.admin.getPairingQR', owner.token, { connectionMode: 'automatic' })
    ).toMatchObject({ ok: true, result: { available: false, reason: 'relay_mint_failed' } })
  })

  it('revokes only the selected scope without removing the browser credential', async () => {
    const { call, owner, mobile, registry } = fixture()
    expect(
      await call('pairing.admin.revokeDevice', owner.token, { deviceId: owner.deviceId })
    ).toMatchObject({ result: { revoked: false } })
    expect(
      await call('pairing.admin.revokeDevice', owner.token, { deviceId: mobile.deviceId })
    ).toMatchObject({ result: { revoked: true } })
    expect(registry.validateToken(owner.token)?.deviceId).toBe(owner.deviceId)
    expect(registry.validateToken(mobile.token)).toBeNull()
  })

  it('does not give local agent-token dispatch pairing administration authority', async () => {
    const { runtime } = fixture()
    const dispatcher = new RpcDispatcher({ runtime, methods: PAIRING_ADMINISTRATION_METHODS })
    expect(
      await dispatcher.dispatch({ id: 'agent', authToken: '', method: 'pairing.admin.listDevices' })
    ).toMatchObject({ ok: false })
  })
})
