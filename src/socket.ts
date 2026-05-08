import { measure } from './profiling'
import { Scoring } from './scoring'
import type { Payload } from './types'

export type SocketState = { buffer: Buffer }

function wire(body: string): Buffer {
  return Buffer.from(
    'HTTP/1.1 200 OK\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: keep-alive\r\n' +
      '\r\n' +
      body
  )
}

const responses = [
  wire('{"approved":true,"fraud_score":0}'),
  wire('{"approved":true,"fraud_score":0.2}'),
  wire('{"approved":true,"fraud_score":0.4}'),
  wire('{"approved":false,"fraud_score":0.6}'),
  wire('{"approved":false,"fraud_score":0.8}'),
  wire('{"approved":false,"fraud_score":1}'),
]

const readyResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
    'Content-Length: 2\r\n' +
    'Connection: keep-alive\r\n' +
    '\r\n' +
    'ok'
)

const CRLFCRLF = Buffer.from('\r\n\r\n')
const CONTENT_LENGTH = Buffer.from('Content-Length:')
const EMPTY = Buffer.allocUnsafe(0)

export const Socket = {
  parsePayload(body: string): Payload {
    return JSON.parse(body) as Payload
  },

  findContentLength(buffer: Buffer, end: number): number {
    const index = buffer.indexOf(CONTENT_LENGTH)

    if (index < 0 || index >= end) {
      return -1
    }

    let cursor = index + CONTENT_LENGTH.length

    while (
      cursor < end &&
      (buffer[cursor] === 0x20 || buffer[cursor] === 0x09)
    ) {
      cursor++
    }

    let length = 0

    while (cursor < end) {
      const code = buffer[cursor]

      if (code < 0x30 || code > 0x39) {
        break
      }

      length = length * 10 + code - 0x30
      cursor++
    }

    return length
  },

  handler: {
    open(socket: Bun.Socket<SocketState>) {
      socket.data = { buffer: EMPTY }
    },

    data(socket: Bun.Socket<SocketState>, chunk: Buffer) {
      const state = socket.data

      state.buffer =
        state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk])

      while (state.buffer.length > 0) {
        const headerEnd = state.buffer.indexOf(CRLFCRLF)

        if (headerEnd < 0) {
          return
        }

        const firstByte = state.buffer[0]

        let bodyLength = 0

        if (firstByte === 0x50) {
          bodyLength = Socket.findContentLength(state.buffer, headerEnd)

          if (bodyLength < 0) {
            socket.end()
            return
          }
        }

        const totalLength = headerEnd + 4 + bodyLength

        if (state.buffer.length < totalLength) {
          return
        }

        if (firstByte === 0x50) {
          const body = state.buffer.toString('utf8', headerEnd + 4, totalLength)

          measure.begin('')

          const payload = measure('parse', () => Socket.parsePayload(body))

          measure.identify(payload.id)

          const fraudCount = Scoring.fraudCount(payload)

          measure.finish()

          socket.write(responses[fraudCount])
        } else if (firstByte === 0x47) {
          socket.write(readyResponse)
        } else {
          socket.end()
          return
        }

        if (state.buffer.length === totalLength) {
          state.buffer = EMPTY
        } else {
          state.buffer = state.buffer.subarray(totalLength)
        }
      }
    },
  },
}
