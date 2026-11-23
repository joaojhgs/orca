import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { randomBytes } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { LOCAL_ARTIFACT_MAX_REQUEST_BYTES } from '../../shared/artifacts/artifacts'

type Upload = {
  owner: string
  totalBytes: number
  received: number
  folder: string
  timer?: NodeJS.Timeout
  writing: boolean
}
const uploads = new Map<string, Upload>()
let publishing = false

async function drop(id: string): Promise<void> {
  const upload = uploads.get(id)
  if (!upload) {
    return
  }
  uploads.delete(id)
  clearTimeout(upload.timer)
  await rm(upload.folder, { recursive: true, force: true })
}
function refresh(id: string, upload: Upload): void {
  clearTimeout(upload.timer)
  upload.timer = setTimeout(() => void drop(id).catch(() => {}), 5 * 60_000)
  upload.timer.unref()
}
export function revokeArtifactUploads(owner: string): void {
  for (const [id, upload] of uploads) {
    if (upload.owner === owner) {
      void drop(id).catch(() => {})
    }
  }
}

export async function beginArtifactUpload(
  owner: string,
  totalBytes: number
): Promise<{ uploadId: string }> {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 1 ||
    totalBytes > LOCAL_ARTIFACT_MAX_REQUEST_BYTES
  ) {
    throw new Error('Artifact exceeds the supported size')
  }
  // Reserve before the first await; large document commits must not compete for the controller's RAM.
  if (uploads.size || publishing) {
    throw new Error('An artifact upload is already in progress; try again shortly')
  }
  const uploadId = randomBytes(24).toString('base64url')
  const upload: Upload = { owner, totalBytes, received: 0, folder: '', writing: true }
  uploads.set(uploadId, upload)
  try {
    const staging = join(getProfileUserDataPath(), 'artifact-uploads')
    await mkdir(staging, { recursive: true, mode: 0o700 })
    for (const name of await readdir(staging)) {
      if (!/^upload-[A-Za-z0-9]+$/.test(name)) {
        continue
      }
      const path = join(staging, name)
      if ((await stat(path)).mtimeMs < Date.now() - 10 * 60_000) {
        await rm(path, { recursive: true, force: true })
      }
    }
    upload.folder = await mkdtemp(join(staging, 'upload-'))
    await writeFile(join(upload.folder, 'request.json'), '', { mode: 0o600 })
    if (uploads.get(uploadId) !== upload) {
      throw new Error('Artifact upload disconnected')
    }
    upload.writing = false
    refresh(uploadId, upload)
    return { uploadId }
  } catch (error) {
    await drop(uploadId)
    if (upload.folder) {
      await rm(upload.folder, { recursive: true, force: true })
    }
    throw error
  }
}

function requireUpload(owner: string, id: string): Upload {
  const upload = uploads.get(id)
  if (!upload || upload.owner !== owner || upload.writing) {
    throw new Error('Artifact upload expired, busy or belongs to another connection')
  }
  return upload
}

export async function appendArtifactUpload(
  owner: string,
  id: string,
  offset: number,
  contentBase64: string
): Promise<void> {
  const upload = requireUpload(owner, id)
  const bytes = Buffer.from(contentBase64, 'base64')
  if (
    bytes.length > 192 * 1024 ||
    bytes.length === 0 ||
    bytes.toString('base64') !== contentBase64 ||
    offset !== upload.received ||
    offset + bytes.length > upload.totalBytes
  ) {
    throw new Error('Invalid artifact upload chunk')
  }
  upload.writing = true
  try {
    await appendFile(join(upload.folder, 'request.json'), bytes)
    upload.received += bytes.length
    refresh(id, upload)
  } finally {
    upload.writing = false
  }
}

export async function consumeArtifactUpload<T>(
  owner: string,
  id: string,
  publish: (request: unknown) => Promise<T>
): Promise<T> {
  const upload = requireUpload(owner, id)
  if (upload.received !== upload.totalBytes) {
    throw new Error('Artifact upload is incomplete')
  }
  if (publishing) {
    throw new Error('Another artifact is being published')
  }
  publishing = true
  upload.writing = true
  clearTimeout(upload.timer)
  try {
    const request: unknown = JSON.parse(await readFile(join(upload.folder, 'request.json'), 'utf8'))
    return await publish(request)
  } finally {
    publishing = false
    await drop(id)
  }
}

export async function abortArtifactUpload(owner: string, id: string): Promise<void> {
  requireUpload(owner, id)
  await drop(id)
}
