import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, createConnection } from 'node:net'
import { brokerMetadata, startIpcBroker } from './controller-ipc-broker.mjs'

const read = (path, input) => new Promise((resolve, reject) => {
  let result = ''
  const socket = createConnection(path)
  socket.on('error', reject)
  socket.on('data', (chunk) => { result += chunk.toString() })
  socket.on('end', () => resolve(result))
  socket.on('connect', () => { if (input) socket.write(input) })
})

test('forwards RPC unchanged and publishes fresh metadata without the owner credential', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-broker-test-'))
  const profile = join(root, 'profile')
  const directory = join(root, 'broker')
  mkdirSync(profile, { mode: 0o700 })
  mkdirSync(directory, { mode: 0o700 })
  const endpoint = join(profile, 'runtime.sock')
  const upstream = createServer((socket) => socket.on('data', (data) => socket.end(data)))
  await new Promise((resolve) => upstream.listen(endpoint, resolve))
  const metadataPath = join(profile, 'orca-runtime.json')
  const publish = (runtimeId) => writeFileSync(metadataPath, JSON.stringify({
    runtimeId, pid: 123, startedAt: 100, transports: [{ kind: 'unix', endpoint }],
    authToken: 'owner-secret-must-not-cross'
  }), { mode: 0o600 })
  publish('first-runtime')
  const broker = await startIpcBroker(profile, directory)
  try {
    const raw = await read(join(directory, 'metadata.sock'))
    assert.equal(raw.includes('owner-secret'), false)
    const first = JSON.parse(raw)
    assert.equal(first.runtimeId, 'first-runtime')
    assert.equal(first.pid, 0)
    assert.equal(first.transports[0].endpoint, '/run/hermes-manager-transport/orca.sock')
    const request = '{"id":"service-test","method":"manager.eventsRead"}\n'
    assert.equal(await read(join(directory, 'rpc.sock'), request), request)
    publish('restarted-runtime')
    assert.equal(JSON.parse(await read(join(directory, 'metadata.sock'))).runtimeId, 'restarted-runtime')
    const valid = JSON.parse(readFileSync(metadataPath, 'utf8'))
    writeFileSync(metadataPath, JSON.stringify({ ...valid, startedAt: { authToken: 'owner-secret' } }))
    assert.throws(() => brokerMetadata(profile), /does not address/)
    writeFileSync(metadataPath, JSON.stringify({
      ...valid, transports: [{ kind: 'unix', endpoint: `${profile}/../profile/runtime.sock` }]
    }))
    assert.throws(() => brokerMetadata(profile), /does not address/)
    publish('restarted-runtime')
    chmodSync(metadataPath, 0o644)
    assert.equal(await read(join(directory, 'metadata.sock')), '')
    chmodSync(metadataPath, 0o600)
    unlinkSync(metadataPath)
    const shadow = join(root, 'shadow.json')
    writeFileSync(shadow, JSON.stringify(valid), { mode: 0o600 })
    symlinkSync(shadow, metadataPath)
    assert.throws(() => brokerMetadata(profile), { code: 'ELOOP' })
  } finally {
    await broker.close()
    await new Promise((resolve) => upstream.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
