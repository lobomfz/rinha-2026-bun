import { appendFile } from 'node:fs/promises'
import type { ScoreResult } from './summary'

export async function log(result: ScoreResult) {
  const commitProcess = Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })

  const statusProcess = Bun.spawn(['git', 'status', '--short'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })

  const commit = await new Response(commitProcess.stdout).text()
  const status = await new Response(statusProcess.stdout).text()

  await appendFile(
    'bench/custom/history.jsonl',
    `${JSON.stringify({
      at: new Date().toISOString(),
      commit: commit.trim(),
      dirty: status.trim().length > 0,
      p50: result.latency['p(50)'],
      p95: result.latency['p(95)'],
      p99: result.p99,
      max: result.latency.max,
      score: result.totalScore,
      requests: result.counts.requests,
      dropped: result.counts.droppedIterations,
      fp: result.counts.falsePositives,
      fn: result.counts.falseNegatives,
      httpErrors: result.counts.httpErrors,
      scoreMismatches: result.counts.scoreMismatches,
    })}\n`
  )

  console.log('logged=bench/custom/history.jsonl')
}
