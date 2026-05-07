import fixtures from '../../data/test-data.json'
import { K6 } from '../k6'
import { BenchServer } from '../server'
import { ScoreSummary } from './summary'

type Fixtures = {
  stats: unknown
}

const server = BenchServer.start()

try {
  await BenchServer.waitUntilReady()

  const k6 = await K6.run({
    name: 'score',
    script: 'bench/custom/test.js',
    resultsDir: 'bench/custom/results',
  })

  const summary = await ScoreSummary.read(k6.resultPath)

  const result = ScoreSummary.analyze(summary)

  for (const line of ScoreSummary.format(
    result,
    (fixtures as Fixtures).stats,
    k6.resultPath
  )) {
    console.log(line)
  }

  if (k6.exitCode !== 0) {
    process.exit(k6.exitCode)
  }

  if (ScoreSummary.failed(result)) {
    process.exit(1)
  }
} finally {
  await BenchServer.stop(server)
}
