import { chmodSync, existsSync, unlinkSync } from 'fs'
import { CONSTANTS } from '@Config/constants'
import { measure } from './profiling'
import { Search } from './search'
import { Socket, type SocketState } from './socket'

Search.warmup(CONSTANTS.WARMUP)
measure.startEventLoopProbe()

if (existsSync(CONSTANTS.SOCK_PATH)) {
  unlinkSync(CONSTANTS.SOCK_PATH)
}

Bun.listen<SocketState>({
  unix: CONSTANTS.SOCK_PATH,
  socket: Socket.handler,
})

chmodSync(CONSTANTS.SOCK_PATH, 0o666)

console.log(`listening on ${CONSTANTS.SOCK_PATH}, n=${Search.size}`)
