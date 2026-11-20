import { createServer, isIP, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { WebSocket } from 'ws'
import { NETWORK_FORWARD_MAX_BUFFER } from '../../shared/network-forward-contract'

export async function startLocalNetworkForward(options: {
  port: number
  ticket: () => Promise<{ url: string; connectAddress?: string }>
}) {
  const connections = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (local) => {
    if (connections.size >= 16) {
      local.destroy()
      return
    }
    connections.add(local)
    local.pause()
    local.setNoDelay(true)
    let remote: WebSocket | undefined
    let ready = false
    let closed = false
    let pong = true
    const close = () => {
      if (closed) {
        return
      }
      closed = true
      clearTimeout(deadline)
      clearInterval(heartbeat)
      connections.delete(local)
      local.destroy()
      remote?.terminate()
    }
    const deadline = setTimeout(close, 20000)
    const heartbeat = setInterval(() => {
      if (remote?.readyState !== WebSocket.OPEN) {
        return
      }
      if (!pong) {
        close()
        return
      }
      pong = false
      remote.ping()
    }, 20000)
    local.on('error', close).on('close', close)
    void options
      .ticket()
      .then(({ url, connectAddress }) => {
        if (closed) {
          return
        }
        const endpoint = new URL(url)
        if (endpoint.protocol !== 'wss:' || (connectAddress && !isIP(connectAddress))) {
          throw new Error('Secure controller transport required')
        }
        remote = new WebSocket(url, {
          // Owner-selected OCI private address; retain certificate/hostname verification.
          ...(connectAddress
            ? {
                createConnection: () =>
                  connectTls({
                    host: connectAddress,
                    port: Number(endpoint.port) || 443,
                    servername: endpoint.hostname
                  })
              }
            : {}),
          maxPayload: NETWORK_FORWARD_MAX_BUFFER,
          handshakeTimeout: 12000,
          followRedirects: false
        })
        remote
          .on('error', close)
          .on('close', close)
          .on('pong', () => {
            pong = true
          })
        remote.on('message', (data, binary) => {
          if (closed || !remote) {
            return
          }
          if (!binary) {
            if (data.toString() === '{"type":"end"}' && ready) {
              local.end()
              return
            }
            let value: unknown
            try {
              value = JSON.parse(data.toString())
            } catch {
              close()
              return
            }
            if (
              ready ||
              typeof value !== 'object' ||
              !value ||
              !('type' in value) ||
              value.type !== 'ready'
            ) {
              close()
              return
            }
            ready = true
            clearTimeout(deadline)
            local.on('data', (bytes) => {
              if (
                !remote ||
                remote.readyState !== WebSocket.OPEN ||
                remote.bufferedAmount > NETWORK_FORWARD_MAX_BUFFER
              ) {
                close()
                return
              }
              local.pause()
              remote.send(bytes, { binary: true }, (error) => {
                if (error) {
                  close()
                } else if (!closed) {
                  local.resume()
                }
              })
            })
            local.on('end', () => remote?.send('{"type":"end"}'))
            local.resume()
            return
          }
          if (!ready) {
            close()
            return
          }
          remote.pause()
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : data
          local.write(bytes, (error) => {
            if (error) {
              close()
            } else if (!closed) {
              remote?.resume()
            }
          })
        })
      })
      .catch(close)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Loopback listener unavailable')
  }
  return {
    host: '127.0.0.1',
    port: address.port,
    close: () => {
      for (const socket of connections) {
        socket.destroy()
      }
      server.close()
    }
  }
}
