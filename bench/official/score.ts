import { mkdir, rm, symlink } from 'node:fs/promises'
import { BenchServer } from '../server'

const dataLink = 'bench/official/test/test-data.json'
const resultPath = 'bench/official/test/results.json'

await mkdir('bench/official/test', { recursive: true })
await rm(dataLink, { force: true })
await rm(resultPath, { force: true })
await symlink('../../../data/test-data.json', dataLink)

const server = BenchServer.startSource()

try {
  await BenchServer.waitUntilReady()

  console.log('k6 running bench/official/test/test.js')

  const k6 = await Bun.spawn(['k6', 'run', 'test/test.js'], {
    cwd: 'bench/official',
    stdout: 'ignore',
    stderr: 'ignore',
  }).exited

  if (!(await Bun.file(resultPath).exists())) {
    throw new Error('k6 did not write results.json')
  }

  console.log(JSON.stringify(await Bun.file(resultPath).json(), null, 2))

  if (k6 !== 0) {
    process.exitCode = k6
  }
} finally {
  await BenchServer.stop(server)
}
