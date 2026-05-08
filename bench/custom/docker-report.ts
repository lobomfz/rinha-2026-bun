import { rm } from 'node:fs/promises'
import { ScoreSummary } from './summary'

const resultPath = `/tmp/rinha-v2-score-${process.pid}.json`

const exitCode = await Bun.spawn(
  [
    'k6',
    'run',
    '--quiet',
    '--summary-export',
    resultPath,
    'bench/custom/test.js',
  ],
  {
    stdout: 'ignore',
    stderr: 'ignore',
  }
).exited

const wroteSummary = await Bun.file(resultPath).exists()

if (!wroteSummary) {
  console.log(
    JSON.stringify({
      ok: false,
      at: new Date().toISOString(),
      error: 'k6 did not write a summary',
      exitCode,
    })
  )
  process.exit(1)
}

const summary = await ScoreSummary.read(resultPath)
const result = ScoreSummary.analyze(summary)

await rm(resultPath, { force: true })

console.log(
  JSON.stringify({
    ok: exitCode === 0,
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

if (exitCode !== 0) {
  process.exit(exitCode)
}
