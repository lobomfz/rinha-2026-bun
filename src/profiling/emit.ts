import {
  EVENT_LOOP_INTERVAL_NS,
  PERF_SAMPLE_RATE,
  SLOWEST_CAPACITY,
  SYSTEM_SNAPSHOT_INTERVAL_MS,
} from './constants'
import { cgroupDelta, recordSystemSnapshot } from './probes'
import { COUNTERS, HISTOGRAM_BOUNDS_NS, PHASES } from './schema'
import type { Counter, Phase } from './schema'
import {
  counterSums,
  counts,
  eventLoopWorst,
  samples,
  slowest,
  systemSnapshots,
} from './state'

function summarize(values: Float64Array, length: number) {
  if (length === 0) {
    return {
      count: 0,
      mean: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      p999: 0,
      p9999: 0,
      max: 0,
      topN: [] as number[],
    }
  }

  const sorted = values.slice(0, length).sort()
  let sum = 0

  for (let i = 0; i < length; i++) {
    sum += sorted[i]
  }

  return {
    count: length,
    mean: Math.round(sum / length),
    p50: sorted[Math.floor(length * 0.5)],
    p95: sorted[Math.floor(length * 0.95)],
    p99: sorted[Math.floor(length * 0.99)],
    p999: sorted[Math.floor(length * 0.999)],
    p9999: sorted[Math.floor(length * 0.9999)],
    max: sorted[length - 1],
    topN: Array.from(
      sorted.slice(Math.max(0, length - SLOWEST_CAPACITY), length)
    ).reverse(),
  }
}

function histogram(values: Float64Array, length: number) {
  const bins = new Uint32Array(HISTOGRAM_BOUNDS_NS.length + 1)

  for (let i = 0; i < length; i++) {
    const value = values[i]
    let bin = 0

    while (
      bin < HISTOGRAM_BOUNDS_NS.length &&
      value >= HISTOGRAM_BOUNDS_NS[bin]
    ) {
      bin++
    }

    bins[bin]++
  }

  return {
    unit: 'ns',
    bins: [
      ...HISTOGRAM_BOUNDS_NS.map((ltNs, index) => ({
        ltNs,
        count: bins[index],
      })),
      {
        geNs: HISTOGRAM_BOUNDS_NS.at(-1)!,
        count: bins[HISTOGRAM_BOUNDS_NS.length],
      },
    ],
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function counterAverages() {
  const out: Record<string, number> = {}

  for (const c of COUNTERS) {
    out[c] = counts.sample === 0 ? 0 : round2(counterSums[c] / counts.sample)
  }

  return out
}

function pathRowCount(pathCounter: Counter) {
  let rows = 0

  for (let i = 0; i < counts.sample; i++) {
    if (samples.counter[pathCounter][i] > 0) {
      rows++
    }
  }

  return rows
}

function summarizePathRows(values: Float64Array, pathCounter: Counter) {
  const filtered = new Float64Array(counts.sample)
  let rows = 0

  for (let i = 0; i < counts.sample; i++) {
    if (samples.counter[pathCounter][i] > 0) {
      filtered[rows] = values[i]
      rows++
    }
  }

  return summarize(filtered, rows)
}

function counterAveragesForPath(pathCounter: Counter, rows: number) {
  const out: Record<string, number> = {}

  for (const c of COUNTERS) {
    let sum = 0

    for (let i = 0; i < counts.sample; i++) {
      if (samples.counter[pathCounter][i] > 0) {
        sum += samples.counter[c][i]
      }
    }

    out[c] = rows === 0 ? 0 : round2(sum / rows)
  }

  return out
}

function pathSummary(pathCounter: Counter) {
  const rows = pathRowCount(pathCounter)
  const phases: Record<string, ReturnType<typeof summarize>> = {
    totalNs: summarizePathRows(samples.totalNs, pathCounter),
  }

  for (const p of PHASES) {
    phases[`${p}Ns`] = summarizePathRows(samples.phase[p], pathCounter)
  }

  phases.scannedVectors = summarizePathRows(
    samples.counter.scannedVectors,
    pathCounter
  )
  phases.scannedBuckets = summarizePathRows(
    samples.counter.scannedBuckets,
    pathCounter
  )
  phases.skippedBuckets = summarizePathRows(
    samples.counter.skippedBuckets,
    pathCounter
  )
  phases.selectedBuckets = summarizePathRows(
    samples.counter.selectedBuckets,
    pathCounter
  )
  phases.requestBytes = summarizePathRows(
    samples.counter.requestBytes,
    pathCounter
  )
  phases.activeAtStart = summarizePathRows(samples.activeAtStart, pathCounter)
  phases.inFlight = summarizePathRows(samples.inFlight, pathCounter)

  const vpb = new Float64Array(rows)
  let row = 0

  for (let i = 0; i < counts.sample; i++) {
    if (samples.counter[pathCounter][i] === 0) {
      continue
    }

    const scannedBuckets = samples.counter.scannedBuckets[i]

    vpb[row] =
      scannedBuckets > 0
        ? samples.counter.scannedVectors[i] / scannedBuckets
        : 0
    row++
  }

  phases.vectorsPerBucket = summarize(vpb, rows)

  return {
    requests: rows,
    phases,
    counters: counterAveragesForPath(pathCounter, rows),
  }
}

export function snapshot() {
  const row = counts.sample - 1
  const out: Record<string, number> = {}

  if (row < 0) {
    return out
  }

  out.totalNs = samples.totalNs[row]

  for (const p of PHASES) {
    out[`${p}Ns`] = samples.phase[p][row]
  }

  for (const c of COUNTERS) {
    out[c] = samples.counter[c][row]
  }

  return out
}

const slowestPhases: Phase[] = [
  'recvBuffered',
  'parse',
  'search',
  'selectFine',
  'fastSelectFine',
  'fastLb',
  'fastScanSelected',
  'fallbackSelectFine',
  'fallbackLb',
  'fallbackScanSelected',
  'sfLut',
  'sfInit',
  'sfBuild',
  'sfMain',
  'lb',
  'scan',
  'writeOut',
]

function slowestExpanded() {
  return slowest.map(({ id, traceId, row }) => {
    const entry: Record<string, number | string> = {
      id,
      traceId,
      totalNs: samples.totalNs[row],
      socketReadableOffsetNs: samples.socketReadableOffset[row],
      requestCompleteOffsetNs: samples.requestCompleteOffset[row],
      handlerStartOffsetNs: samples.handlerStartOffset[row],
      writeQueuedOffsetNs: samples.writeQueuedOffset[row],
      writeDoneOffsetNs: samples.writeDoneOffset[row],
      writeDrainOffsetNs: samples.writeDrainOffset[row],
      heapDelta: samples.heapDelta[row],
      heapGrowthBytes: samples.heapGrowth[row],
      heapCollectedBytes: samples.heapCollected[row],
      heapTotalDelta: samples.heapTotalDelta[row],
      rssDelta: samples.rssDelta[row],
      interArrivalNs: samples.interArrival[row],
      inFlight: samples.inFlight[row],
      activeAtStart: samples.activeAtStart[row],
    }

    for (const p of slowestPhases) {
      entry[`${p}Ns`] = samples.phase[p][row]
    }

    entry.selectedBuckets = samples.counter.selectedBuckets[row]
    entry.scannedBuckets = samples.counter.scannedBuckets[row]
    entry.skippedBuckets = samples.counter.skippedBuckets[row]
    entry.scannedVectors = samples.counter.scannedVectors[row]
    entry.fastPath = samples.counter.fastPath[row]
    entry.fallbackPath = samples.counter.fallbackPath[row]
    entry.requestBytes = samples.counter.requestBytes[row]
    entry.writeExpectedBytes = samples.counter.writeExpectedBytes[row]
    entry.writeReturnedBytes = samples.counter.writeReturnedBytes[row]
    entry.writeShort = samples.counter.writeShort[row]

    return entry
  })
}

export function emit() {
  recordSystemSnapshot()

  const phases: Record<string, ReturnType<typeof summarize>> = {
    totalNs: summarize(samples.totalNs, counts.sample),
  }

  for (const p of PHASES) {
    phases[`${p}Ns`] = summarize(samples.phase[p], counts.sample)
  }

  phases.scanCallNs = summarize(samples.scanCall, counts.scanCall)
  phases.scannedVectors = summarize(samples.counter.scannedVectors, counts.sample)
  phases.scannedBuckets = summarize(samples.counter.scannedBuckets, counts.sample)
  phases.requestBytes = summarize(samples.counter.requestBytes, counts.sample)
  phases.activeAtStart = summarize(samples.activeAtStart, counts.sample)
  phases.inFlight = summarize(samples.inFlight, counts.sample)

  const vpb = new Float64Array(counts.sample)

  for (let i = 0; i < counts.sample; i++) {
    const sb = samples.counter.scannedBuckets[i]

    vpb[i] = sb > 0 ? samples.counter.scannedVectors[i] / sb : 0
  }

  phases.vectorsPerBucket = summarize(vpb, counts.sample)

  const histograms: Record<string, ReturnType<typeof histogram>> = {
    totalNs: histogram(samples.totalNs, counts.sample),
    scanCallNs: histogram(samples.scanCall, counts.scanCall),
  }

  for (const p of PHASES) {
    histograms[`${p}Ns`] = histogram(samples.phase[p], counts.sample)
  }

  const paths = {
    fast: pathSummary('fastPath'),
    fallback: pathSummary('fallbackPath'),
  }

  console.log(
    `__profile__ ${JSON.stringify({
      process: 'api',
      requests: counts.sample,
      phases,
      histograms,
      paths,
      counters: counterAverages(),
      activeRequests: {
        current: counts.activeRequests,
        max: counts.maxActiveRequests,
        atStart: summarize(samples.activeAtStart, counts.sample),
      },
      gcProxy: {
        heapDelta: summarize(samples.heapDelta, counts.sample),
        heapGrowthBytes: summarize(samples.heapGrowth, counts.sample),
        heapCollectedBytes: summarize(samples.heapCollected, counts.sample),
        heapTotalDelta: summarize(samples.heapTotalDelta, counts.sample),
        rssDelta: summarize(samples.rssDelta, counts.sample),
      },
      eventLoop: {
        intervalNs: EVENT_LOOP_INTERVAL_NS,
        ticks: counts.eventLoopLag,
        lagNs: summarize(samples.eventLoopLag, counts.eventLoopLag),
        worstLagNs: eventLoopWorst,
      },
      system: {
        intervalMs: SYSTEM_SNAPSHOT_INTERVAL_MS,
        snapshots: systemSnapshots,
      },
      perf: {
        sampleRate: PERF_SAMPLE_RATE,
        samples: counts.perfSample,
        wallNs: summarize(samples.perfWall, counts.perfSample),
        cpuUserUs: summarize(samples.perfCpuUser, counts.perfSample),
        cpuSystemUs: summarize(samples.perfCpuSystem, counts.perfSample),
        cpuTotalUs: summarize(samples.perfCpuTotal, counts.perfSample),
      },
      cgroup: cgroupDelta(),
      slowest: slowestExpanded(),
    })}`
  )
}

process.on('SIGTERM', () => {
  emit()
  process.exit(0)
})

process.on('SIGUSR2', () => {
  emit()
})
