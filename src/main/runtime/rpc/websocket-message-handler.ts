import type { WebSocket } from 'ws'

type WebSocketMessagePayload = string | Uint8Array<ArrayBufferLike>

export type WebSocketMessageHandler = {
  bivarianceHack(
    msg: WebSocketMessagePayload,
    reply: (response: string) => void,
    ws: WebSocket
  ): void
}['bivarianceHack']
