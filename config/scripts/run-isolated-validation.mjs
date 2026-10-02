import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, delimiter } from 'node:path'

const commandArgs = process.argv.slice(2)
const buildOnly = commandArgs[0] === '--build'
if (buildOnly) {
  commandArgs.shift()
}
const [command, ...args] = commandArgs
if (!command) {
  throw new Error(
    'Usage: node config/scripts/run-isolated-validation.mjs [--build] <command> [args...]'
  )
}
if (process.platform !== 'linux') {
  throw new Error('This validation wrapper requires Linux systemd user services')
}
const memoryMb = Number(process.env.ORCA_VALIDATION_MEMORY_MB ?? 768)
const memoryCeilingMb = buildOnly ? 2048 : 1024
if (!Number.isInteger(memoryMb) || memoryMb < 128 || memoryMb > memoryCeilingMb) {
  throw new Error(`ORCA_VALIDATION_MEMORY_MB must be an integer between 128 and ${memoryCeilingMb}`)
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
    `--property=MemoryMax=${memoryMb}M`,
    '--property=MemorySwapMax=0',
    '--property=OOMPolicy=kill',
    '--property=CPUQuota=100%',
    '--property=RuntimeMaxSec=1800',
    `--property=WorkingDirectory=${process.cwd()}`,
    `--setenv=NODE_OPTIONS=--max-old-space-size=${Math.floor(memoryMb * 0.65)}`,
    '--setenv=ORCA_BACKGROUND_LAUNCH=1',
    `--setenv=ORCA_BUILD_MAX_OLD_SPACE_MB=${Math.floor(memoryMb * 0.65)}`,
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
