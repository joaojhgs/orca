import { afterEach, describe, expect, it } from 'vitest'
import { buildSshPtySpawnEnv } from './ssh-pty-spawn-env'

const GUI_KEYS = [
  'ORCA_HEADLESS_GUI_ENV',
  'DISPLAY',
  'XAUTHORITY',
  'DBUS_SESSION_BUS_ADDRESS',
  'AT_SPI_BUS_ADDRESS',
  'NO_AT_BRIDGE'
] as const

describe('buildSshPtySpawnEnv', () => {
  afterEach(() => {
    for (const key of GUI_KEYS) {
      delete process.env[key]
    }
  })

  it('forwards the host headless GUI environment when enabled', () => {
    process.env.ORCA_HEADLESS_GUI_ENV = '1'
    process.env.DISPLAY = ':99'
    process.env.XAUTHORITY = '/tmp/orca-headless-runtime/Xauthority'
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/tmp/orca-headless-runtime/session-bus'
    process.env.AT_SPI_BUS_ADDRESS = 'unix:path=/tmp/orca-headless-runtime/at-spi/bus_99'
    process.env.NO_AT_BRIDGE = '1'

    expect(buildSshPtySpawnEnv({ env: {}, forwardHostGuiEnv: true })).toMatchObject({
      DISPLAY: ':99',
      XAUTHORITY: '/tmp/orca-headless-runtime/Xauthority',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/orca-headless-runtime/session-bus',
      AT_SPI_BUS_ADDRESS: 'unix:path=/tmp/orca-headless-runtime/at-spi/bus_99',
      NO_AT_BRIDGE: '0'
    })
  })
})
