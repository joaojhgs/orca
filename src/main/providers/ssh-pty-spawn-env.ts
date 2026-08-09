import { seedPowerlevel10kWizardEnv } from '../pty/powerlevel10k-wizard-env'
import type { RemoteCliBridgeEnv } from './ssh-pty-provider-contract'

export function buildSshPtySpawnEnv(args: {
  env: Record<string, string> | undefined
  envToDelete?: readonly string[]
  remoteCliBridgeEnv?: RemoteCliBridgeEnv
  forwardHostGuiEnv?: boolean
}): Record<string, string> {
  const merged = { ...args.env }
  if (args.forwardHostGuiEnv && process.env.ORCA_HEADLESS_GUI_ENV === '1') {
    for (const key of [
      'DISPLAY',
      'DBUS_SESSION_BUS_ADDRESS',
      'AT_SPI_BUS_ADDRESS',
      'NO_AT_BRIDGE',
      'XDG_SESSION_TYPE'
    ]) {
      const value = process.env[key]
      if (value) {
        merged[key] = value
      }
    }
  }
  if (args.remoteCliBridgeEnv) {
    const pathDelimiter = args.remoteCliBridgeEnv.pathDelimiter ?? ':'
    const pathKey = merged.PATH !== undefined ? 'PATH' : merged.Path !== undefined ? 'Path' : null
    if (pathKey) {
      const pathValue = merged[pathKey] ?? ''
      merged[pathKey] = pathValue.split(pathDelimiter).includes(args.remoteCliBridgeEnv.binDir)
        ? pathValue
        : pathValue
          ? `${args.remoteCliBridgeEnv.binDir}${pathDelimiter}${pathValue}`
          : args.remoteCliBridgeEnv.binDir
    }
    merged.ORCA_REMOTE_CLI_BIN_DIR = args.remoteCliBridgeEnv.binDir
    merged.ORCA_RELAY_DIR = args.remoteCliBridgeEnv.relayDir
    merged.ORCA_RELAY_NODE_PATH = args.remoteCliBridgeEnv.nodePath
    merged.ORCA_RELAY_SOCKET_PATH = args.remoteCliBridgeEnv.sockPath
    if (args.remoteCliBridgeEnv.credentialFile) {
      merged.ORCA_RELAY_CREDENTIAL_FILE = args.remoteCliBridgeEnv.credentialFile
    }
  }
  // Why: match local/daemon precedence—managed defaults cannot restore explicitly removed values.
  for (const key of args.envToDelete ?? []) {
    delete merged[key]
  }
  seedPowerlevel10kWizardEnv(merged, { envToDelete: args.envToDelete })
  return merged
}
