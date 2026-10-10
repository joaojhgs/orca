import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import {
  AndroidPreviewResult,
  AndroidPreviewAction
} from '../../shared/ssh-android-preview-contract'
import type { DirectSshAuthority } from '../../shared/ssh-types'
import { executionObserverClient } from '../execution-observer/observer-client'
import { getSshConnectionManager, listRegisteredSshTargets } from '../ssh/ssh-target-registry'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority
} from '../ssh/ssh-provider-authority'
import { readSshPreviewPolicy } from '../computer/ssh-preview-policy'
import type { EmulatorDevice } from './backends/emulator-backend'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import { parseUiAutomatorXml } from './android/uiautomator-tree'

const PREFIX = 'ssh-adb:'
const Tuple = z.tuple([z.string().min(1).max(256), z.string().min(1).max(256)])
type ActiveAndroidPreview = { deviceId: string; authority: DirectSshAuthority; fingerprint: string }
const activeByWorkspace = new Map<string, ActiveAndroidPreview>()
const streams = new Map<string, ActiveAndroidPreview & { checkedAt: number }>()
let inFlight = 0

function assertActiveAuthority(active: ActiveAndroidPreview) {
  if (
    !isCurrentSshProviderAuthority(active.authority) ||
    readSshPreviewPolicy().fingerprint !== active.fingerprint
  ) {
    throw new Error('Android preview authority expired. Reattach its device.')
  }
}

export function sshAndroidDeviceId(targetId: string, serial: string): string {
  return `${PREFIX}${Buffer.from(JSON.stringify([targetId, serial])).toString('base64url')}`
}

function parseDeviceId(deviceId: string) {
  if (!deviceId.startsWith(PREFIX) || deviceId.length > 1500) {
    throw new Error('Invalid SSH Android target')
  }
  const [targetId, serial] = Tuple.parse(
    JSON.parse(Buffer.from(deviceId.slice(PREFIX.length), 'base64url').toString('utf8'))
  )
  if (sshAndroidDeviceId(targetId, serial) !== deviceId) {
    throw new Error('Invalid SSH Android target')
  }
  return { targetId, serial }
}

async function observe(targetId: string, action: AndroidPreviewAction) {
  const policy = readSshPreviewPolicy()
  const approval = policy.hosts.find((host) => host.targetId === targetId)?.adb
  const connection = getSshConnectionManager()?.getConnection(targetId)
  if (!approval || connection?.getState().status !== 'connected') {
    throw new Error('Approved Android SSH host is unavailable. Reconnect its host.')
  }
  const authority = getSshProviderAuthority(targetId)
  if (inFlight >= 4) {
    throw new Error('Android preview is busy. Reconnect after other requests finish.')
  }
  inFlight += 1
  let observed: unknown
  try {
    observed = await executionObserverClient.observe(
      { operation: 'android-preview', approval, action },
      connection
    )
  } finally {
    inFlight -= 1
  }
  const parsed = AndroidPreviewResult.safeParse(observed)
  if (!parsed.success) {
    throw new Error(
      'Android preview is unavailable on its SSH host. Check ADB installation and device authorization.'
    )
  }
  const result = parsed.data
  if (
    !isCurrentSshProviderAuthority(authority) ||
    readSshPreviewPolicy().fingerprint !== policy.fingerprint
  ) {
    throw new Error('Android preview authority expired')
  }
  return { result, authority, fingerprint: policy.fingerprint }
}

export async function listSshAndroidDevices(): Promise<EmulatorDevice[]> {
  const labels = new Map(listRegisteredSshTargets().map((target) => [target.id, target.label]))
  const hosts = readSshPreviewPolicy().hosts.filter((host) => host.adb)
  const perHost = await mapWithConcurrency(hosts, 2, async (host) => {
    if (
      getSshConnectionManager()?.getConnection(host.targetId)?.getState().status !== 'connected'
    ) {
      return []
    }
    const { result } = await observe(host.targetId, { kind: 'list' })
    if (!('devices' in result)) {
      throw new Error('Android inventory was not returned')
    }
    return result.devices.map((device): EmulatorDevice => ({
      backend: 'android',
      id: sshAndroidDeviceId(host.targetId, device.serial),
      name: `${labels.get(host.targetId) ?? host.targetId} · ${device.label}`,
      state: device.state === 'device' ? 'booted' : 'shutdown',
      isAvailable: device.state === 'device',
      detail: device.state === 'device' ? 'SSH device' : device.state
    }))
  })
  return perHost.flat()
}

function selectedDevice(params: {
  device?: string
  emulator?: string
  worktree?: string
}): string | undefined {
  const explicit = params.device ?? params.emulator
  if (explicit) {
    return explicit
  }
  const active = params.worktree ? activeByWorkspace.get(params.worktree) : undefined
  if (!active) {
    return undefined
  }
  assertActiveAuthority(active)
  return active.deviceId
}

type AndroidCommandParams = {
  device?: string
  emulator?: string
  worktree?: string
  x?: number
  y?: number
  text?: string
  name?: string
  orientation?: string
  points?: unknown
  lines?: number
  package?: string
  activity?: string
  op?: string
  permission?: string
}

export async function dispatchSshAndroidPreview(method: string, params: AndroidCommandParams) {
  const closing = ['emulator.shutdown', 'emulator.kill', 'emulator.unregisterActive'].includes(
    method
  )
  if (closing && params.worktree && activeByWorkspace.has(params.worktree)) {
    const active = activeByWorkspace.get(params.worktree)
    activeByWorkspace.delete(params.worktree)
    for (const [id, stream] of streams) {
      if (stream.deviceId === active?.deviceId) {
        streams.delete(id)
      }
    }
    return { handled: true as const, result: { ok: true } }
  }
  let deviceId = selectedDevice(params)
  let stream: ActiveAndroidPreview | undefined
  if (deviceId?.startsWith('ssh-adb-stream:')) {
    const active = streams.get(deviceId)
    if (method !== 'emulator.screenshot' || !active || Date.now() - active.checkedAt > 60000) {
      throw new Error('Android preview expired. Reattach its device.')
    }
    assertActiveAuthority(active)
    active.checkedAt = Date.now()
    stream = active
    deviceId = active.deviceId
  }
  if (!deviceId?.startsWith(PREFIX)) {
    return { handled: false as const }
  }
  const { targetId, serial } = parseDeviceId(deviceId)
  if (method === 'emulator.attach') {
    const { result, authority, fingerprint } = await observe(targetId, { kind: 'list' })
    if (
      !('devices' in result) ||
      !result.devices.some((device) => device.serial === serial && device.state === 'device')
    ) {
      throw new Error('Approved Android device is not connected or authorized')
    }
    if (params.worktree) {
      if (!activeByWorkspace.has(params.worktree) && activeByWorkspace.size >= 128) {
        throw new Error('Too many Android previews')
      }
      activeByWorkspace.set(params.worktree, { deviceId, authority, fingerprint })
    }
    for (const [id, stream] of streams) {
      if (Date.now() - stream.checkedAt > 60000) {
        streams.delete(id)
      }
    }
    if (streams.size >= 32) {
      throw new Error('Too many Android preview streams')
    }
    const streamId = `ssh-adb-stream:${randomBytes(24).toString('base64url')}`
    streams.set(streamId, { deviceId, authority, fingerprint, checkedAt: Date.now() })
    return {
      handled: true as const,
      result: {
        attached: true,
        info: {
          deviceUdid: deviceId,
          streamUrl: `remote-adb://${streamId}`,
          wsUrl: '',
          streamCodec: 'mjpeg',
          backend: 'android'
        }
      }
    }
  }
  if (
    method === 'emulator.shutdown' ||
    method === 'emulator.kill' ||
    method === 'emulator.unregisterActive'
  ) {
    // Disconnect this preview only; closing a pane must never power off a shared device.
    if (params.worktree) {
      activeByWorkspace.delete(params.worktree)
    }
    return { handled: true as const, result: { ok: true } }
  }
  const kind = method.slice('emulator.'.length)
  if (
    ![
      'screenshot',
      'tap',
      'gesture',
      'type',
      'button',
      'rotate',
      'ax',
      'logcat',
      'launch',
      'permissions'
    ].includes(kind)
  ) {
    throw new Error('This Android command is not supported through SSH preview')
  }
  const action = AndroidPreviewAction.parse({
    kind,
    serial,
    ...(kind === 'tap' ? { x: params.x, y: params.y } : {}),
    ...(kind === 'gesture' ? { points: params.points } : {}),
    ...(kind === 'type' ? { text: params.text } : {}),
    ...(kind === 'button' ? { name: params.name } : {}),
    ...(kind === 'rotate' ? { orientation: params.orientation } : {}),
    ...(kind === 'logcat' ? { lines: params.lines } : {}),
    ...(kind === 'launch' ? { package: params.package, activity: params.activity } : {}),
    ...(kind === 'permissions'
      ? { op: params.op, package: params.package, permission: params.permission }
      : {})
  })
  const { result } = await observe(targetId, action)
  if (stream) {
    assertActiveAuthority(stream)
  }
  return {
    handled: true as const,
    result:
      'xml' in result
        ? parseUiAutomatorXml(result.xml)
        : 'entries' in result
          ? result.entries
          : result
  }
}
