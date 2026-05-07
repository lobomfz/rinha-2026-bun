type Metric = Record<string, number>

type K6Summary = {
  metrics: Record<string, Metric>
}

const counters = [
  ['requests', 'http_reqs'],
  ['falsePositives', 'false_positives'],
  ['falseNegatives', 'false_negatives'],
  ['httpErrors', 'http_errors'],
  ['scoreMismatches', 'score_mismatches'],
  ['droppedIterations', 'dropped_iterations'],
] as const

type ScoreCounts = Record<(typeof counters)[number][0], number>

interface ScoreResult {
  counts: ScoreCounts
  latency: Metric
  p99: number
  p99Score: number
  detectionScore: number
  totalScore: number
}

export const ScoreSummary = {
  scoreLine(result: ScoreResult) {
    return `score=${result.totalScore.toFixed(0)} p99_score=${result.p99Score.toFixed(0)} detection_score=${result.detectionScore.toFixed(0)}`
  },

  latencyLine(result: ScoreResult) {
    const p50 = result.latency['p(50)']
    const p95 = result.latency['p(95)']
    const max = result.latency['max']

    return `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(
      2
    )}ms p99=${result.p99.toFixed(2)}ms max=${max.toFixed(2)}ms`
  },

  countMetrics(metrics: K6Summary['metrics']) {
    const counts = {} as ScoreCounts

    for (const [name, metric] of counters) {
      counts[name] = metrics[metric].count!
    }

    return counts
  },

  read(path: string): Promise<K6Summary> {
    return Bun.file(path).json()
  },

  analyze(summary: K6Summary) {
    const latency = summary.metrics.http_req_duration

    const counts = this.countMetrics(summary.metrics)

    const weightedErrors =
      counts.falsePositives + counts.falseNegatives * 3 + counts.httpErrors * 5

    const epsilon = counts.requests > 0 ? weightedErrors / counts.requests : 0

    const p99 = latency['p(99)']

    const p99Score =
      p99 > 2000 ? -3000 : 1000 * Math.log10(1000 / Math.max(p99, 1))

    const detectionScore =
      1000 * Math.log10(1 / Math.max(epsilon, 0.001)) -
      300 * Math.log10(1 + weightedErrors)

    return {
      counts,
      latency,
      p99,
      p99Score,
      detectionScore,
      totalScore: p99Score + detectionScore,
    }
  },

  format(result: ScoreResult, stats: unknown, path: string) {
    return [
      `requests=${result.counts.requests} dropped=${result.counts.droppedIterations}`,
      this.latencyLine(result),
      `fp=${result.counts.falsePositives} fn=${result.counts.falseNegatives} http_errors=${result.counts.httpErrors} score_mismatch=${result.counts.scoreMismatches}`,
      this.scoreLine(result),
      `stats=${JSON.stringify(stats)}`,
      `saved=${path}`,
    ]
  },

  failed(result: ScoreResult) {
    if (result.counts.falsePositives > 0) {
      return true
    }

    if (result.counts.falseNegatives > 0) {
      return true
    }

    if (result.counts.httpErrors > 0) {
      return true
    }

    if (result.counts.scoreMismatches > 0) {
      return true
    }

    return false
  },
}
