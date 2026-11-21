import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactPublishingApprovalController } from './artifact-publishing-approval'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'orca-artifact-approval-'))
  directories.push(directory)
  const apply = vi.fn()
  let now = 1000
  const controller = new ArtifactPublishingApprovalController(
    () => directory,
    apply,
    () => now
  )
  return {
    directory,
    apply,
    controller,
    expire: () => {
      now += 300_001
    }
  }
}

describe('host-shell artifact publishing approval', () => {
  it('never grants permission by requesting or checking without host proof', async () => {
    const { controller, apply } = await fixture()
    const request = await controller.request(true, 'browser')
    expect(await controller.check(request.requestId, 'browser')).toBe('pending')
    expect(apply).not.toHaveBeenCalled()
  })

  it('requires the requesting device, a private regular file and exact proof', async () => {
    const { controller, directory, apply } = await fixture()
    const request = await controller.request(true, 'browser')
    const path = join(directory, `${request.requestId}.approval`)
    await expect(controller.check(request.requestId, 'other')).rejects.toThrow('not found')
    await writeFile(path, 'incorrect', { mode: 0o600 })
    expect(await controller.check(request.requestId, 'browser')).toBe('pending')
    const proof = request.command.match(/'([^']*ARTIFACT[^']*)'/)?.[1]
    expect(proof).toBeDefined()
    await writeFile(path, proof ?? '')
    expect(await controller.check(request.requestId, 'browser')).toBe('approved')
    expect(apply).toHaveBeenCalledExactlyOnceWith(true)
    await expect(controller.check(request.requestId, 'browser')).rejects.toThrow('not found')
  })

  it('refuses expired requests and superseded approvals', async () => {
    const { controller, apply, expire } = await fixture()
    const old = await controller.request(true, 'browser')
    const current = await controller.request(false, 'browser')
    await expect(controller.check(old.requestId, 'browser')).rejects.toThrow('not found')
    expire()
    expect(await controller.check(current.requestId, 'browser')).toBe('expired')
    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses symlink proofs', async () => {
    const { controller, directory, apply } = await fixture()
    const request = await controller.request(true, 'browser')
    const target = join(directory, 'target')
    await writeFile(target, request.command.match(/'([^']*ARTIFACT[^']*)'/)?.[1] ?? '', {
      mode: 0o600
    })
    await symlink(target, join(directory, `${request.requestId}.approval`))
    expect(await controller.check(request.requestId, 'browser')).toBe('pending')
    expect(apply).not.toHaveBeenCalled()
  })
})
