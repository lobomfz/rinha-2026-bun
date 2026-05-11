import fixtures from '../../data/test-data.json'
import { BenchDocker } from '../docker'
import { K6 } from '../k6'
import { ScoreSummary } from './summary'

await BenchDocker.up({ profile: true })

try {
  await BenchDocker.waitUntilReady()

  const k6 = await K6.run({
    name: 'profile',
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

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      p50: result.latency['p(50)'],
      p95: result.latency['p(95)'],
      p99: result.p99,
      max: result.latency.max,
      requests: result.counts.requests,
      dropped: result.counts.droppedIterations,
      fp: result.counts.falsePositives,
      fn: result.counts.falseNegatives,
      httpErrors: result.counts.httpErrors,
      scoreMismatches: result.counts.scoreMismatches,
      p99Score: result.p99Score,
      detectionScore: result.detectionScore,
      score: result.totalScore,
    })
  )

  await BenchDocker.stop({ profile: true })

  const logs = await BenchDocker.profileLogs()

  for (const line of logs.split('\n')) {
    if (line.includes('__profile__')) {
      console.log(line)
    }
  }

  const lbLogs = await BenchDocker.lbLogs()

  for (const line of lbLogs.split('\n')) {
    if (line.includes('__profile__')) {
      console.log(line)
    }
  }

  if (k6.exitCode !== 0) {
    process.exitCode = k6.exitCode
  }

  if (ScoreSummary.failed(result)) {
    process.exitCode = 1
  }
} finally {
  await BenchDocker.down({ profile: true })
}
