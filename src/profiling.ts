import { readFileSync } from 'node:fs'

const PHASES = [
  'recvBuffered',
  'parse',
  'vectorize',
  'quantize',
  'search',
  'selectFine',
  'sfLut',
  'sfInit',
  'sfBuild',
  'sfMain',
  'lb',
  'scan',
  'writeOut',
] as const

const COUNTERS = [
  'requestBytes',
  'selectedBuckets',
  'scannedBuckets',
  'skippedBuckets',
  'scannedVectors',
  'fraudCount',
  'scanExitAtDim4',
  'scanExitAtDim8',
  'scanExitAtDim12',
  'scanExitAtDim14',
] as const

type Phase = (typeof PHASES)[number]
type Counter = (typeof COUNTERS)[number]

interface CgroupStat {
  nr_periods: number
  nr_throttled: number
  throttled_usec: number
}

const SAMPLE_CAPACITY = 256_000
const SLOWEST_CAPACITY = 20
const SCAN_CALL_CAPACITY = 512_000
const EVENT_LOOP_INTERVAL_MS = 10
const EVENT_LOOP_INTERVAL_NS = EVENT_LOOP_INTERVAL_MS * 1_000_000
const EVENT_LOOP_SAMPLE_CAPACITY = 120_000
const SYSTEM_SNAPSHOT_INTERVAL_MS = 1_000
const SYSTEM_SNAPSHOT_CAPACITY = 120
const PERF_SAMPLE_RATE = 64
const PERF_SAMPLE_CAPACITY = Math.ceil(SAMPLE_CAPACITY / PERF_SAMPLE_RATE)
const HISTOGRAM_BOUNDS_NS = [
  1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 512_000,
  1_000_000, 2_000_000, 4_000_000, 8_000_000, 10_000_000,
] as const

const TRACE_ID = Buffer.from('X-Rinha-Trace-Id:')

const phaseSamples = {} as Record<Phase, Float64Array>
const counterSamples = {} as Record<Counter, Float64Array>
const totalNsSamples = new Float64Array(SAMPLE_CAPACITY)
const heapDeltaSamples = new Float64Array(SAMPLE_CAPACITY)
const heapGrowthSamples = new Float64Array(SAMPLE_CAPACITY)
const heapCollectedSamples = new Float64Array(SAMPLE_CAPACITY)
const heapTotalDeltaSamples = new Float64Array(SAMPLE_CAPACITY)
const rssDeltaSamples = new Float64Array(SAMPLE_CAPACITY)
const interArrivalSamples = new Float64Array(SAMPLE_CAPACITY)
const inFlightSamples = new Float64Array(SAMPLE_CAPACITY)
const scanCallSamples = new Float64Array(SCAN_CALL_CAPACITY)
const eventLoopLagSamples = new Float64Array(EVENT_LOOP_SAMPLE_CAPACITY)
const perfWallNsSamples = new Float64Array(PERF_SAMPLE_CAPACITY)
const perfCpuUserUsSamples = new Float64Array(PERF_SAMPLE_CAPACITY)
const perfCpuSystemUsSamples = new Float64Array(PERF_SAMPLE_CAPACITY)
const perfCpuTotalUsSamples = new Float64Array(PERF_SAMPLE_CAPACITY)
const counterSums = {} as Record<Counter, number>

for (const p of PHASES) {
  phaseSamples[p] = new Float64Array(SAMPLE_CAPACITY)
}

for (const c of COUNTERS) {
  counterSamples[c] = new Float64Array(SAMPLE_CAPACITY)
  counterSums[c] = 0
}

let sampleCount = 0
let scanCallCount = 0
let eventLoopLagCount = 0
let perfSampleCount = 0
let startedAt = 0
let currentId = ''
let currentTraceId = 0
let heapStart = 0
let heapTotalStart = 0
let rssStart = 0
let lastFinishedAt = 0
let inFlight = 0
let perfSampled = false
let perfStartedAt = 0
let perfUserStartedAt = 0
let perfSystemStartedAt = 0

const slowest: { id: string; traceId: number; totalNs: number; row: number }[] =
  []
const eventLoopWorst: number[] = []

interface SystemSnapshot {
  atNs: number
  load1: number
  load5: number
  load15: number
  rssBytes: number
  voluntaryContextSwitches: number
  nonvoluntaryContextSwitches: number
}

const systemSnapshots: SystemSnapshot[] = []

function readCgroup(): CgroupStat | null {
  try {
    const text = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf-8')
    const stat: CgroupStat = {
      nr_periods: 0,
      nr_throttled: 0,
      throttled_usec: 0,
    }

    for (const line of text.split('\n')) {
      const space = line.indexOf(' ')

      if (space < 0) {
        continue
      }

      const name = line.slice(0, space)
      const value = Number(line.slice(space + 1))

      if (name === 'nr_periods') {
        stat.nr_periods = value
        continue
      }

      if (name === 'nr_throttled') {
        stat.nr_throttled = value
        continue
      }

      if (name === 'throttled_usec') {
        stat.throttled_usec = value
      }
    }

    return stat
  } catch {
    return null
  }
}

const cgroupBaseline = readCgroup()

function cgroupDelta() {
  if (!cgroupBaseline) {
    return null
  }

  const now = readCgroup()

  if (!now) {
    return null
  }

  const periods = now.nr_periods - cgroupBaseline.nr_periods
  const throttled = now.nr_throttled - cgroupBaseline.nr_throttled

  return {
    nr_periods: periods,
    nr_throttled: throttled,
    throttled_usec: now.throttled_usec - cgroupBaseline.throttled_usec,
    throttled_ratio:
      periods > 0 ? Math.round((throttled / periods) * 10000) / 10000 : 0,
  }
}

function readSystemSnapshot(): SystemSnapshot | null {
  try {
    const loadParts = readFileSync('/proc/loadavg', 'utf-8').trim().split(/\s+/)

    const status = readFileSync('/proc/self/status', 'utf-8')
    let rssBytes = process.memoryUsage().rss
    let voluntaryContextSwitches = 0
    let nonvoluntaryContextSwitches = 0

    for (const line of status.split('\n')) {
      const separator = line.indexOf(':')

      if (separator < 0) {
        continue
      }

      const name = line.slice(0, separator)
      const value = line.slice(separator + 1).trim()

      if (name === 'VmRSS') {
        rssBytes = Number(value.split(/\s+/)[0]) * 1024
        continue
      }

      if (name === 'voluntary_ctxt_switches') {
        voluntaryContextSwitches = Number(value)
        continue
      }

      if (name === 'nonvoluntary_ctxt_switches') {
        nonvoluntaryContextSwitches = Number(value)
      }
    }

    return {
      atNs: Bun.nanoseconds(),
      load1: Number(loadParts[0] ?? 0),
      load5: Number(loadParts[1] ?? 0),
      load15: Number(loadParts[2] ?? 0),
      rssBytes,
      voluntaryContextSwitches,
      nonvoluntaryContextSwitches,
    }
  } catch {
    return null
  }
}

function recordSystemSnapshot() {
  const snapshot = readSystemSnapshot()

  if (!snapshot) {
    return
  }

  if (systemSnapshots.length >= SYSTEM_SNAPSHOT_CAPACITY) {
    systemSnapshots.shift()
  }

  systemSnapshots.push(snapshot)
}

function insertWorst(values: number[], value: number) {
  if (values.length < SLOWEST_CAPACITY) {
    values.push(value)
  } else if (value > values[SLOWEST_CAPACITY - 1]) {
    values[SLOWEST_CAPACITY - 1] = value
  } else {
    return
  }

  let i = values.length - 1

  while (i > 0 && values[i - 1] < values[i]) {
    const tmp = values[i - 1]

    values[i - 1] = values[i]
    values[i] = tmp
    i--
  }
}

let eventLoopProbeStarted = false
let expectedEventLoopAt = 0

function recordEventLoopLag() {
  const now = Bun.nanoseconds()
  const lag = Math.max(0, now - expectedEventLoopAt)

  if (eventLoopLagCount < EVENT_LOOP_SAMPLE_CAPACITY) {
    eventLoopLagSamples[eventLoopLagCount] = lag
    eventLoopLagCount++
  }

  insertWorst(eventLoopWorst, lag)
  expectedEventLoopAt = now + EVENT_LOOP_INTERVAL_NS
}

function startEventLoopProbe() {
  if (eventLoopProbeStarted) {
    return
  }

  eventLoopProbeStarted = true
  eventLoopLagCount = 0
  eventLoopWorst.length = 0
  expectedEventLoopAt = Bun.nanoseconds() + EVENT_LOOP_INTERVAL_NS

  setInterval(recordEventLoopLag, EVENT_LOOP_INTERVAL_MS)
}

recordSystemSnapshot()
setInterval(recordSystemSnapshot, SYSTEM_SNAPSHOT_INTERVAL_MS)

function runMeasure(name: Phase, fn: () => number, resultName: Counter): number
function runMeasure<T>(name: Phase, fn: () => T): T
function runMeasure<T>(name: Phase, fn: () => T, resultName?: Counter) {
  const start = Bun.nanoseconds()
  const result = fn()

  add(name, Bun.nanoseconds() - start)

  if (resultName) {
    if (typeof result !== 'number') {
      throw new TypeError('measured result must be a number to be saved')
    }

    set(resultName, result)
  }

  return result
}

function begin(id: string, firstByteAt = 0) {
  inFlight++
  currentId = id
  const now = Bun.nanoseconds()

  if (sampleCount >= SAMPLE_CAPACITY) {
    startedAt = now
    return
  }

  interArrivalSamples[sampleCount] =
    lastFinishedAt > 0 ? now - lastFinishedAt : 0
  const memory = process.memoryUsage()

  heapStart = memory.heapUsed
  heapTotalStart = memory.heapTotal
  rssStart = memory.rss
  inFlightSamples[sampleCount] = inFlight
  startedAt = now
  perfSampled =
    perfSampleCount < PERF_SAMPLE_CAPACITY &&
    sampleCount % PERF_SAMPLE_RATE === 0

  if (perfSampled) {
    const cpu = process.cpuUsage()

    perfStartedAt = now
    perfUserStartedAt = cpu.user
    perfSystemStartedAt = cpu.system
  }

  for (const p of PHASES) {
    phaseSamples[p][sampleCount] = 0
  }

  if (firstByteAt > 0) {
    phaseSamples.recvBuffered[sampleCount] = now - firstByteAt
  }

  for (const c of COUNTERS) {
    counterSamples[c][sampleCount] = 0
  }
}

function markFirstByte(state: { firstByteAt: number }) {
  state.firstByteAt = Bun.nanoseconds()
}

function identify(id: string) {
  currentId = id
}

function setTraceId(buffer: Buffer, end: number) {
  const index = buffer.indexOf(TRACE_ID)

  if (index < 0 || index >= end) {
    currentTraceId = 0
    return
  }

  let cursor = index + TRACE_ID.length

  while (cursor < end && (buffer[cursor] === 0x20 || buffer[cursor] === 0x09)) {
    cursor++
  }

  let traceId = 0

  while (cursor < end) {
    const code = buffer[cursor]

    if (code < 0x30 || code > 0x39) {
      break
    }

    traceId = traceId * 10 + code - 0x30
    cursor++
  }

  currentTraceId = traceId
}

function add(name: Phase, elapsedNs: number) {
  if (sampleCount >= SAMPLE_CAPACITY) {
    return
  }

  phaseSamples[name][sampleCount] += elapsedNs
}

function set(name: Counter, value: number) {
  if (sampleCount >= SAMPLE_CAPACITY) {
    return
  }

  counterSamples[name][sampleCount] = value
}

function addCounter(name: Counter, value: number) {
  if (sampleCount >= SAMPLE_CAPACITY) {
    return
  }

  counterSamples[name][sampleCount] += value
}

function count(name: Counter, value = 1) {
  addCounter(name, value)
}

function finish() {
  if (sampleCount >= SAMPLE_CAPACITY) {
    inFlight = Math.max(0, inFlight - 1)
    return
  }

  const now = Bun.nanoseconds()
  const totalNs = now - startedAt
  const memory = process.memoryUsage()
  const heapDelta = memory.heapUsed - heapStart

  totalNsSamples[sampleCount] = totalNs
  heapDeltaSamples[sampleCount] = heapDelta
  heapGrowthSamples[sampleCount] = heapDelta > 0 ? heapDelta : 0
  heapCollectedSamples[sampleCount] = heapDelta < 0 ? -heapDelta : 0
  heapTotalDeltaSamples[sampleCount] = memory.heapTotal - heapTotalStart
  rssDeltaSamples[sampleCount] = memory.rss - rssStart
  lastFinishedAt = now

  if (perfSampled && perfSampleCount < PERF_SAMPLE_CAPACITY) {
    const cpu = process.cpuUsage()
    const user = cpu.user - perfUserStartedAt
    const system = cpu.system - perfSystemStartedAt

    perfWallNsSamples[perfSampleCount] = now - perfStartedAt
    perfCpuUserUsSamples[perfSampleCount] = user
    perfCpuSystemUsSamples[perfSampleCount] = system
    perfCpuTotalUsSamples[perfSampleCount] = user + system
    perfSampleCount++
  }

  for (const c of COUNTERS) {
    counterSums[c] += counterSamples[c][sampleCount]
  }

  insertSlowest(currentId, currentTraceId, totalNs, sampleCount)
  currentTraceId = 0
  sampleCount++
  inFlight = Math.max(0, inFlight - 1)
}

function scanCall(elapsedNs: number) {
  if (scanCallCount >= SCAN_CALL_CAPACITY) {
    return
  }

  scanCallSamples[scanCallCount] = elapsedNs
  scanCallCount++
}

function insertSlowest(
  id: string,
  traceId: number,
  totalNs: number,
  row: number
) {
  if (slowest.length < SLOWEST_CAPACITY) {
    slowest.push({ id, traceId, totalNs, row })
  } else if (totalNs > slowest[SLOWEST_CAPACITY - 1].totalNs) {
    slowest[SLOWEST_CAPACITY - 1] = { id, traceId, totalNs, row }
  } else {
    return
  }

  let i = slowest.length - 1

  while (i > 0 && slowest[i - 1].totalNs < slowest[i].totalNs) {
    const tmp = slowest[i - 1]

    slowest[i - 1] = slowest[i]
    slowest[i] = tmp
    i--
  }
}

function summarize(samples: Float64Array, length: number) {
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

  const sorted = samples.slice(0, length).sort()
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

function histogram(samples: Float64Array, length: number) {
  const counts = new Uint32Array(HISTOGRAM_BOUNDS_NS.length + 1)

  for (let i = 0; i < length; i++) {
    const value = samples[i]
    let bin = 0

    while (
      bin < HISTOGRAM_BOUNDS_NS.length &&
      value >= HISTOGRAM_BOUNDS_NS[bin]
    ) {
      bin++
    }

    counts[bin]++
  }

  return {
    unit: 'ns',
    bins: [
      ...HISTOGRAM_BOUNDS_NS.map((ltNs, index) => ({
        ltNs,
        count: counts[index],
      })),
      {
        geNs: HISTOGRAM_BOUNDS_NS.at(-1)!,
        count: counts[HISTOGRAM_BOUNDS_NS.length],
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
    out[c] = sampleCount === 0 ? 0 : round2(counterSums[c] / sampleCount)
  }

  return out
}

function snapshot() {
  const row = sampleCount - 1
  const out: Record<string, number> = {}

  if (row < 0) {
    return out
  }

  out.totalNs = totalNsSamples[row]

  for (const p of PHASES) {
    out[`${p}Ns`] = phaseSamples[p][row]
  }

  for (const c of COUNTERS) {
    out[c] = counterSamples[c][row]
  }

  return out
}

const slowestPhases: Phase[] = [
  'recvBuffered',
  'parse',
  'search',
  'selectFine',
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
      totalNs: totalNsSamples[row],
      heapDelta: heapDeltaSamples[row],
      heapGrowthBytes: heapGrowthSamples[row],
      heapCollectedBytes: heapCollectedSamples[row],
      heapTotalDelta: heapTotalDeltaSamples[row],
      rssDelta: rssDeltaSamples[row],
      interArrivalNs: interArrivalSamples[row],
      inFlight: inFlightSamples[row],
    }

    for (const p of slowestPhases) {
      entry[`${p}Ns`] = phaseSamples[p][row]
    }

    entry.scannedBuckets = counterSamples.scannedBuckets[row]
    entry.scannedVectors = counterSamples.scannedVectors[row]
    entry.requestBytes = counterSamples.requestBytes[row]

    return entry
  })
}

function emit() {
  recordSystemSnapshot()

  const phases: Record<string, ReturnType<typeof summarize>> = {
    totalNs: summarize(totalNsSamples, sampleCount),
  }

  for (const p of PHASES) {
    phases[`${p}Ns`] = summarize(phaseSamples[p], sampleCount)
  }

  phases.scanCallNs = summarize(scanCallSamples, scanCallCount)
  phases.scannedVectors = summarize(counterSamples.scannedVectors, sampleCount)
  phases.scannedBuckets = summarize(counterSamples.scannedBuckets, sampleCount)
  phases.requestBytes = summarize(counterSamples.requestBytes, sampleCount)

  const vpb = new Float64Array(sampleCount)

  for (let i = 0; i < sampleCount; i++) {
    const sb = counterSamples.scannedBuckets[i]

    vpb[i] = sb > 0 ? counterSamples.scannedVectors[i] / sb : 0
  }

  phases.vectorsPerBucket = summarize(vpb, sampleCount)

  const histograms: Record<string, ReturnType<typeof histogram>> = {
    totalNs: histogram(totalNsSamples, sampleCount),
    scanCallNs: histogram(scanCallSamples, scanCallCount),
  }

  for (const p of PHASES) {
    histograms[`${p}Ns`] = histogram(phaseSamples[p], sampleCount)
  }

  console.log(
    `__profile__ ${JSON.stringify({
      process: 'api',
      requests: sampleCount,
      phases,
      histograms,
      counters: counterAverages(),
      gcProxy: {
        heapDelta: summarize(heapDeltaSamples, sampleCount),
        heapGrowthBytes: summarize(heapGrowthSamples, sampleCount),
        heapCollectedBytes: summarize(heapCollectedSamples, sampleCount),
        heapTotalDelta: summarize(heapTotalDeltaSamples, sampleCount),
        rssDelta: summarize(rssDeltaSamples, sampleCount),
      },
      eventLoop: {
        intervalNs: EVENT_LOOP_INTERVAL_NS,
        ticks: eventLoopLagCount,
        lagNs: summarize(eventLoopLagSamples, eventLoopLagCount),
        worstLagNs: eventLoopWorst,
      },
      system: {
        intervalMs: SYSTEM_SNAPSHOT_INTERVAL_MS,
        snapshots: systemSnapshots,
      },
      perf: {
        sampleRate: PERF_SAMPLE_RATE,
        samples: perfSampleCount,
        wallNs: summarize(perfWallNsSamples, perfSampleCount),
        cpuUserUs: summarize(perfCpuUserUsSamples, perfSampleCount),
        cpuSystemUs: summarize(perfCpuSystemUsSamples, perfSampleCount),
        cpuTotalUs: summarize(perfCpuTotalUsSamples, perfSampleCount),
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

export const measure = Object.assign(runMeasure, {
  add,
  addCounter,
  begin,
  count,
  emit,
  finish,
  identify,
  markFirstByte,
  scanCall,
  set,
  setTraceId,
  startEventLoopProbe,
  snapshot,
})
