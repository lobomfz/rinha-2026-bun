import fixtures from '../../data/test-data.json'
import { K6 } from '../k6'
import { BenchServer } from '../server'
import { log } from './log'
import { ScoreSummary } from './summary'

type Fixtures = {
  stats: unknown
}

const shouldLog = Bun.argv[2] === 'true'
const server = BenchServer.start()

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
    (fixtures as Fixtures).stats,
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
  await BenchServer.stop(server)
}
