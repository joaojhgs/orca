import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createServer, createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

export function brokerMetadata(profile) {
  const fd = openSync(join(profile, 'orca-runtime.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > 16_384 || info.uid !== process.getuid() || info.mode & 0o077) {
      throw new Error('Runtime metadata is not a private owner-controlled file')
    }
    const value = JSON.parse(readFileSync(fd, 'utf8'))
    const endpoint = (value.transports ?? [value.transport]).find((row) => row?.kind === 'unix')?.endpoint
    if (typeof value.runtimeId !== 'string' || !value.runtimeId || value.runtimeId.length > 200 ||
        !Number.isSafeInteger(value.startedAt) || value.startedAt < 0 ||
        typeof endpoint !== 'string' || dirname(endpoint) !== resolve(profile) || endpoint.includes('\0')) {
      throw new Error('Runtime metadata does not address this profile')
    }
    const socket = lstatSync(endpoint)
    if (!socket.isSocket() || socket.uid !== process.getuid()) {
      throw new Error('Runtime endpoint is not an owner-controlled socket')
    }
    return {
      endpoint,
      published: {
        runtimeId: value.runtimeId,
        pid: 0,
        startedAt: value.startedAt,
        transports: [{ kind: 'unix', endpoint: '/run/hermes-manager-transport/orca.sock' }],
        authToken: 'manager-service-credential-required'
      }
    }
  } finally {
    closeSync(fd)
  }
}

export async function startIpcBroker(profile, directory) {
  const rpc = createServer((client) => {
    let upstream
    try {
      upstream = createConnection(brokerMetadata(profile).endpoint)
    } catch {
      client.destroy()
      return
    }
    client.setTimeout(90_000, () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    upstream.on('close', () => client.destroy())
    client.pipe(upstream).pipe(client)
  })
  const metadata = createServer((client) => {
    client.on('error', () => {})
    try {
      client.end(`${JSON.stringify(brokerMetadata(profile).published)}\n`)
    } catch {
      client.destroy()
    }
  })
  const listen = (server, path) => new Promise((resolve, reject) => {
    server.maxConnections = 16
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  try {
    await listen(rpc, join(directory, 'rpc.sock'))
    await listen(metadata, join(directory, 'metadata.sock'))
  } catch (error) {
    rpc.close()
    metadata.close()
    throw error
  }
  return { rpc, metadata, close: () => Promise.all([rpc, metadata].map((server) =>
    new Promise((resolve) => server.close(resolve)))) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux' || process.argv.length !== 4) {
    throw new Error('Use the operator-installed Linux service with explicit profile and socket directory')
  }
  await startIpcBroker(process.argv[2], process.argv[3])
}
