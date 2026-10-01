import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, delimiter } from 'node:path'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  throw new Error('Usage: node config/scripts/run-isolated-validation.mjs <command> [args...]')
}
if (process.platform !== 'linux') {
  throw new Error('This validation wrapper requires Linux systemd user services')
}

// Why: an OOM in a terminal-daemon scope stops unrelated PTYs; checks own a bounded service instead.
const child = spawn(
  'systemd-run',
  [
    '--user',
    '--wait',
    '--pipe',
    '--collect',
    `--unit=orca-validation-${randomUUID()}`,
    '--property=MemoryMax=3G',
    '--property=MemorySwapMax=0',
    '--property=OOMPolicy=kill',
    '--property=RuntimeMaxSec=1800',
    `--property=WorkingDirectory=${process.cwd()}`,
    '--setenv=NODE_OPTIONS=--max-old-space-size=2304',
    '--setenv=ORCA_BACKGROUND_LAUNCH=1',
    '--setenv=ORCA_BUILD_MAX_OLD_SPACE_MB=2304',
    `--setenv=PATH=${dirname(process.execPath)}${delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`,
    '--',
    command,
    ...args
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`
    }
  }
)
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
