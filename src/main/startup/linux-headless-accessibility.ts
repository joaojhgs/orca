import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { app } from 'electron'

const RUNTIME_ROOT = '/tmp/orca-headless-runtime'
const SESSION_BUS_SOCKET = `${RUNTIME_ROOT}/session-bus`
const ACCESSIBILITY_CONFIG = `${RUNTIME_ROOT}/accessibility.conf`
const STARTUP_TIMEOUT_MS = 5_000

let sessionBusProcess: ChildProcess | null = null
let accessibilityBusProcess: ChildProcess | null = null

function commandExists(command: string): boolean {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0
}

function waitForPath(path: string): boolean {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return true
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
  return existsSync(path)
}

function displayNumber(): string {
  return process.env.DISPLAY?.match(/^:(\d+)/)?.[1] ?? '99'
}

export function ensureLinuxHeadlessAccessibility(options: { isServeMode: boolean }): boolean {
  if (!options.isServeMode || process.platform !== 'linux') {
    return process.platform !== 'linux'
  }

  process.env.NO_AT_BRIDGE = '0'
  process.env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE || 'x11'
  if (process.env.AT_SPI_BUS_ADDRESS?.trim()) {
    return true
  }
  if (!commandExists('dbus-daemon')) {
    console.warn('[serve] AT-SPI is unavailable; install at-spi2-core and dbus.')
    return false
  }

  const accessibilitySocket = `${RUNTIME_ROOT}/at-spi/bus_${displayNumber()}`
  mkdirSync(`${RUNTIME_ROOT}/at-spi`, { recursive: true, mode: 0o711 })
  chmodSync(RUNTIME_ROOT, 0o711)
  chmodSync(`${RUNTIME_ROOT}/at-spi`, 0o711)
  rmSync(SESSION_BUS_SOCKET, { force: true })
  rmSync(accessibilitySocket, { force: true })

  const sessionBusAddress = `unix:path=${SESSION_BUS_SOCKET}`
  sessionBusProcess = spawn(
    'dbus-daemon',
    ['--session', '--nofork', `--address=${sessionBusAddress}`],
    { stdio: 'ignore' }
  )
  if (!waitForPath(SESSION_BUS_SOCKET)) {
    console.warn('[serve] Private D-Bus session did not become ready; Computer Use is unavailable.')
    stopLinuxHeadlessAccessibility()
    return false
  }

  process.env.DBUS_SESSION_BUS_ADDRESS = sessionBusAddress
  writeFileSync(
    ACCESSIBILITY_CONFIG,
    `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>accessibility</type>
  <servicedir>/usr/share/dbus-1/accessibility-services</servicedir>
  <auth>EXTERNAL</auth>
  <auth>ANONYMOUS</auth>
  <allow_anonymous/>
  <listen>unix:path=${accessibilitySocket}</listen>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>\n`,
    { mode: 0o600 }
  )
  process.env.AT_SPI_BUS_ADDRESS = `unix:path=${accessibilitySocket}`
  accessibilityBusProcess = spawn(
    'dbus-daemon',
    ['--nofork', `--config-file=${ACCESSIBILITY_CONFIG}`],
    {
      stdio: 'ignore'
    }
  )
  if (!waitForPath(accessibilitySocket)) {
    console.warn('[serve] AT-SPI bus did not become ready; Computer Use is unavailable.')
    stopLinuxHeadlessAccessibility()
    return false
  }

  chmodSync(accessibilitySocket, 0o666)
  process.env.ORCA_HEADLESS_GUI_ENV = '1'
  app.once('will-quit', stopLinuxHeadlessAccessibility)
  return true
}

export function stopLinuxHeadlessAccessibility(): void {
  for (const child of [accessibilityBusProcess, sessionBusProcess]) {
    if (child && !child.killed) {
      child.kill()
    }
  }
  accessibilityBusProcess = null
  sessionBusProcess = null
  delete process.env.ORCA_HEADLESS_REMOTE_AT_SPI_ADDRESS
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
}
