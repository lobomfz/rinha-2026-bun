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
  const lineRegex = /Tw=(-?\d+) Tc=(-?\d+) Tt=(-?\d+) ac=(\d+) fc=(\d+) bc=(\d+) sc=(\d+) be=(\S+)/
  const sessions: { Tw: number; Tc: number; Tt: number; ac: number; bc: number; sc: number; server: string }[] = []

  for (const line of lbLogs.split('\n')) {
    const match = lineRegex.exec(line)

    if (!match) {
      continue
    }

    sessions.push({
      Tw: Number(match[1]),
      Tc: Number(match[2]),
      Tt: Number(match[3]),
      ac: Number(match[4]),
      bc: Number(match[6]),
      sc: Number(match[7]),
      server: match[8],
    })
  }

  if (sessions.length > 0) {
    const summarize = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b)
      const sum = sorted.reduce((acc, v) => acc + v, 0)

      return {
        count: sorted.length,
        mean: Math.round(sum / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted.at(-1),
      }
    }

    const slowest = [...sessions].sort((a, b) => b.Tt - a.Tt).slice(0, 20)

    console.log(
      `__lbprofile__ ${JSON.stringify({
        sessions: sessions.length,
        Tw_ms: summarize(sessions.map((s) => s.Tw)),
        Tc_ms: summarize(sessions.map((s) => s.Tc)),
        Tt_ms: summarize(sessions.map((s) => s.Tt)),
        ac: summarize(sessions.map((s) => s.ac)),
        bc: summarize(sessions.map((s) => s.bc)),
        sc: summarize(sessions.map((s) => s.sc)),
        slowest,
      })}`
    )
  } else {
    console.log('__lbprofile__ no_sessions_parsed')
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
