import { basename, extname } from 'node:path'

const PROFILE_PATH = '([A-Za-z0-9][A-Za-z0-9_-]{0,127})'
const LEGACY_PATH = new RegExp(`^/a/${PROFILE_PATH}/([a-f0-9-]{36})/([a-f0-9]{64})$`)
const READABLE_PATH = new RegExp(`^/a/${PROFILE_PATH}/([A-Za-z0-9_-]{43})/([^/]{1,2048})$`)

export type LocalArtifactAddress = {
  profileId: string
  viewToken: string
  slug?: string
}

export function localArtifactUrlFileName(fileName: string): string {
  const name =
    basename(fileName.replaceAll('\\', '/'))
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[.-]+|[.-]+$/g, '') || 'artifact'
  if (Array.from(name).length <= 120) {
    return name
  }
  const extension = extname(name).slice(0, 16)
  return (
    Array.from(name.slice(0, name.length - extension.length))
      .slice(0, 120 - extension.length)
      .join('') + extension
  )
}

export function localArtifactShareUrl(
  origin: string,
  profileId: string,
  viewToken: string,
  fileName: string
): string {
  const token = Buffer.from(viewToken, 'hex').toString('base64url')
  return `${origin}/a/${encodeURIComponent(profileId)}/${token}/${encodeURIComponent(localArtifactUrlFileName(fileName))}`
}

export function parseLocalArtifactPathname(pathname: string): LocalArtifactAddress | null {
  const legacy = LEGACY_PATH.exec(pathname)
  if (legacy) {
    return { profileId: legacy[1]!, slug: legacy[2]!, viewToken: legacy[3]! }
  }
  const readable = READABLE_PATH.exec(pathname)
  if (!readable) {
    return null
  }
  const token = Buffer.from(readable[2]!, 'base64url')
  if (token.length !== 32 || token.toString('base64url') !== readable[2]) {
    return null
  }
  try {
    const name = decodeURIComponent(readable[3]!)
    if (!name || name === '.' || name === '..' || /[\p{Cc}/\\]/u.test(name)) {
      return null
    }
  } catch {
    return null
  }
  // The filename is a label, not identity: renamed artifacts retain earlier links.
  return { profileId: readable[1]!, viewToken: token.toString('hex') }
}
