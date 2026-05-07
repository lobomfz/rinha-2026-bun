export const BenchServer = {
  start() {
    return Bun.spawn(['bun', 'src/index.ts'], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
  },

  async waitUntilReady() {
    for (let attempt = 0; attempt < 120; attempt++) {
      const ready = await fetch('http://127.0.0.1:9999/ready')
        .then((response) => response.ok)
        .catch(() => false)

      if (ready) {
        return
      }

      await Bun.sleep(250)
    }

    throw new Error('server did not answer /ready in 30s')
  },

  async stop(server: Bun.Subprocess) {
    server.kill()
    await server.exited.catch(() => {})
  },
}
