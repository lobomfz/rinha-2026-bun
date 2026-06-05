process.on('SIGUSR2', () => {})

const upstreamPaths = process.env.UPSTREAMS!.split(',')

const channels = await Promise.all(
  upstreamPaths.map((unix) =>
    Bun.fd.connect({
      unix,
      retry: { intervalMs: 100, maxMs: 60_000 },
      close: () => {
        console.error(`upstream ${unix} closed; exiting for docker restart`)
        process.exit(1)
      },
      error: (err) => {
        console.error(`upstream ${unix} error: ${err.message}`)
        process.exit(1)
      },
    })
  )
)

let next = 0

Bun.listen({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT!),
  socket: {
    open(client) {
      client.pause()
      channels[next]!.send(undefined, client)
      next = (next + 1) % upstreamPaths.length
      setImmediate(() => client.close())
    },
    data() {},
  },
})

console.log(
  `bun-lb on :${process.env.PORT}, upstreams=${upstreamPaths.join(',')}`
)
