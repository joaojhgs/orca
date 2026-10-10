import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { RuntimeClientError } from './runtime/types'

const tokenSchema = z.string().regex(/^orcam_[A-Za-z0-9_-]{43}$/)
export function readOptionalManagerCredential(
  environment: NodeJS.ProcessEnv = process.env
): string | null {
  return environment.ORCA_MANAGER_TOKEN !== undefined ||
    environment.ORCA_MANAGER_CREDENTIAL_FILE !== undefined
    ? readManagerCredential(environment)
    : null
}
export function readManagerCredential(environment: NodeJS.ProcessEnv = process.env): string {
  const token = environment.ORCA_MANAGER_TOKEN
  const path = environment.ORCA_MANAGER_CREDENTIAL_FILE
  if (token && path) {
    throw new RuntimeClientError('invalid_argument', 'Select one manager credential source')
  }
  if (token) {
    return tokenSchema.parse(token)
  }
  if (!path) {
    throw new RuntimeClientError('invalid_argument', 'Manager service credential is not configured')
  }
  const fd = openSync(
    path,
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)
  )
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.size > 16_384 ||
      (process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Manager credential file must be private and caller-owned'
      )
    }
    return z.object({ serviceToken: tokenSchema }).parse(JSON.parse(readFileSync(fd, 'utf8')))
      .serviceToken
  } finally {
    closeSync(fd)
  }
}
