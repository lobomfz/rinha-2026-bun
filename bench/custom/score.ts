import fixtures from '../../data/test-data.json'
import { K6 } from '../k6'
import { BenchServer } from '../server'
import { log } from './log'
import { ScoreSummary } from './summary'

const args = new Set(Bun.argv.slice(2))
const shouldLog = args.has('--log') || args.has('true')
const profile = args.has('--profile')

await BenchServer.build()

const server = profile ? BenchServer.startProfile() : BenchServer.startBuilt()

try {
  await BenchServer.waitUntilReady()

  const k6 = await K6.run({
    name: 'score',
    script: 'bench/custom/test.js',
    resultsDir: 'bench/custom/results',
  })

  if (!k6.wroteSummary) {
    throw new Error('k6 did not write a summary')
  }

  const summary = await ScoreSummary.read(k6.resultPath)
  const result = ScoreSummary.analyze(summary)

  for (const line of ScoreSummary.format(
    result,
    fixtures.stats,
    k6.resultPath
  )) {
    console.log(line)
  }

  if (shouldLog) {
    await log(result)
  }

  if (k6.exitCode !== 0) {
    process.exitCode = k6.exitCode
  }

  if (ScoreSummary.failed(result)) {
    process.exitCode = 1
  }
} finally {
  if (profile) {
    await BenchServer.stopAndCollect(server)
  } else {
    await BenchServer.stop(server)
  }
}
