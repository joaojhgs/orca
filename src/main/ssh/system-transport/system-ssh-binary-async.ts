import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { posix, win32 } from 'node:path'
import { systemSshPaths } from './system-ssh-binary'

/** Provider starts must not block Electron's main thread while searching the filesystem. */
export async function findSystemSshAsync(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const api = platform === 'win32' ? win32 : posix
  const executable = platform === 'win32' ? 'ssh.exe' : 'ssh'
  const candidates = env.ORCA_SYSTEM_SSH_PATH
    ? [env.ORCA_SYSTEM_SSH_PATH]
    : [
        ...systemSshPaths(platform),
        ...(env.PATH ?? '')
          .split(api.delimiter)
          .filter(Boolean)
          .map((entry) => api.join(entry.trim().replace(/^"|"$/g, ''), executable))
      ]
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) {
        continue
      }
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return api.resolve(candidate)
    } catch {
      // A failed candidate leaves the next trusted system path or PATH entry to try.
    }
  }
  return null
}
