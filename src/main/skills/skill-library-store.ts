import { lstat, mkdir, open, opendir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  SkillLibraryCatalogSchema,
  type SkillLibraryCatalog
} from '../../shared/skill-library-contract'
import { writeSkillStateFile } from './skill-install-provenance'
import { acquireSkillInstallLock } from './skill-install-lock'

const queues = new Map<string, Promise<unknown>>()

/** A single runtime owns this catalog; serialize read/modify/write, including reads. */
export class SkillLibraryStore {
  constructor(readonly root: string) {}

  transact<T>(operation: (catalog: SkillLibraryCatalog) => Promise<T>, write = true): Promise<T> {
    const key = resolve(this.root)
    const result = (queues.get(key) ?? Promise.resolve()).then(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const rootStat = await lstat(this.root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error('skill-library-root-invalid')
      }
      const release = await acquireSkillInstallLock({
        path: join(this.root, 'catalog.lock'),
        timeoutMs: 30000
      })
      try {
        const catalog = await this.load()
        const value = await operation(catalog)
        if (write) {
          await this.save(catalog)
        }
        return value
      } finally {
        await release()
      }
    })
    const settled = result.catch(() => undefined)
    queues.set(key, settled)
    void settled.then(() => {
      if (queues.get(key) === settled) {
        queues.delete(key)
      }
    })
    return result
  }

  snapshot(): Promise<SkillLibraryCatalog> {
    return this.transact(async (catalog) => structuredClone(catalog), false)
  }

  async archiveBytes(): Promise<number> {
    const path = join(this.root, 'archives')
    await mkdir(path, { recursive: true, mode: 0o700 })
    const directory = await lstat(path)
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error('skill-library-archive-directory-invalid')
    }
    let total = 0
    let count = 0
    // A crash between archive rename and catalog commit must not bypass the disk quota.
    for await (const entry of await opendir(path)) {
      count += 1
      const stat = await lstat(join(path, entry.name))
      if (!stat.isFile() || stat.isSymbolicLink() || count > 2048) {
        throw new Error('skill-library-archive-directory-invalid')
      }
      total += stat.size
      if (total > 256 * 1024 * 1024) {
        throw new Error('skill-library-storage-limit')
      }
    }
    return total
  }

  private async load(): Promise<SkillLibraryCatalog> {
    try {
      const path = join(this.root, 'catalog.json')
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
        throw new Error('skill-library-catalog-invalid')
      }
      const handle = await open(path, 'r')
      try {
        const opened = await handle.stat()
        if (
          !opened.isFile() ||
          opened.dev !== stat.dev ||
          opened.ino !== stat.ino ||
          opened.size !== stat.size
        ) {
          throw new Error('skill-library-catalog-changed')
        }
        const bytes = Buffer.alloc(stat.size + 1)
        let total = 0
        while (total < bytes.length) {
          const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total)
          if (!bytesRead) {
            break
          }
          total += bytesRead
        }
        if (total !== stat.size) {
          throw new Error('skill-library-catalog-changed')
        }
        return SkillLibraryCatalogSchema.parse(
          JSON.parse(bytes.subarray(0, total).toString('utf8'))
        )
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { schemaVersion: 1, versions: [], assignments: [] }
      }
      throw error
    }
  }

  private async save(catalog: SkillLibraryCatalog): Promise<void> {
    const bytes = JSON.stringify(SkillLibraryCatalogSchema.parse(catalog))
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) {
      throw new Error('skill-library-catalog-too-large')
    }
    await writeSkillStateFile(join(this.root, 'catalog.json'), catalog)
  }
}
