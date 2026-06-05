import { CONSTANTS } from '@Config/constants'
import { measure } from './profiling'
import { Search } from './search'
import { Socket, type SocketState } from './socket'

Search.warmup(CONSTANTS.WARMUP)

measure.startEventLoopProbe()

Bun.fd.serve<SocketState>({
  unix: CONSTANTS.SOCK_PATH,
  socket: Socket.handler,
})

console.log(`listening on IPC channel ${CONSTANTS.SOCK_PATH}, n=${Search.size}`)
