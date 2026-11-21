import { createHash } from 'node:crypto'

export function gitBlobSha(bytes: Buffer): Buffer {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest()
}
