import { mkdir, rm, symlink } from 'node:fs/promises'
import { BenchServer } from '../server'

const dataLink = 'bench/official/test/test-data.json'
const resultPath = 'bench/official/test/results.json'

await mkdir('bench/official/test', { recursive: true })
await rm(dataLink, { force: true })
await rm(resultPath, { force: true })
await symlink('../../../data/test-data.json', dataLink)

const server = BenchServer.start()

try {
  await BenchServer.waitUntilReady()

  console.log('k6 running bench/official/test/test.js')

  const exitCode = await Bun.spawn(['k6', 'run', 'test/test.js'], {
    cwd: 'bench/official',
    stdout: 'ignore',
    stderr: 'ignore',
  }).exited

  const wroteResult = await Bun.file(resultPath).exists()

  if (!wroteResult) {
    process.exit(exitCode || 1)
  }

  console.log(JSON.stringify(await Bun.file(resultPath).json(), null, 2))

  if (exitCode !== 0) {
    process.exit(exitCode)
  }
} finally {
  await BenchServer.stop(server)
}
