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
  'selectedBuckets',
  'scannedBuckets',
  'skippedBuckets',
  'scannedVectors',
  'fraudCount',
  'scanExitAtDim4',
  'scanExitAtDim8',
  'scanExitAtDim12',
  'scanExitAtDim14',
  'knnEarlyExits',
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

const phaseSamples = {} as Record<Phase, Float64Array>
const counterSamples = {} as Record<Counter, Float64Array>
const totalNsSamples = new Float64Array(SAMPLE_CAPACITY)
const heapDeltaSamples = new Float64Array(SAMPLE_CAPACITY)
const interArrivalSamples = new Float64Array(SAMPLE_CAPACITY)
const counterSums = {} as Record<Counter, number>

for (const p of PHASES) {
  phaseSamples[p] = new Float64Array(SAMPLE_CAPACITY)
}

for (const c of COUNTERS) {
  counterSamples[c] = new Float64Array(SAMPLE_CAPACITY)
  counterSums[c] = 0
}

let sampleCount = 0
let startedAt = 0
let currentId = ''
let heapStart = 0
let lastFinishedAt = 0

const slowest: { id: string; totalNs: number; row: number }[] = []

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
  currentId = id
  const now = Bun.nanoseconds()

  if (sampleCount >= SAMPLE_CAPACITY) {
    startedAt = now
    return
  }

  interArrivalSamples[sampleCount] = lastFinishedAt > 0 ? now - lastFinishedAt : 0
  heapStart = process.memoryUsage().heapUsed
  startedAt = now

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
    return
  }

  const now = Bun.nanoseconds()
  const totalNs = now - startedAt

  totalNsSamples[sampleCount] = totalNs
  heapDeltaSamples[sampleCount] = process.memoryUsage().heapUsed - heapStart
  lastFinishedAt = now

  for (const c of COUNTERS) {
    counterSums[c] += counterSamples[c][sampleCount]
  }

  insertSlowest(currentId, totalNs, sampleCount)
  sampleCount++
}

function insertSlowest(id: string, totalNs: number, row: number) {
  if (slowest.length < SLOWEST_CAPACITY) {
    slowest.push({ id, totalNs, row })
  } else if (totalNs > slowest[SLOWEST_CAPACITY - 1].totalNs) {
    slowest[SLOWEST_CAPACITY - 1] = { id, totalNs, row }
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
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
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
    max: sorted[length - 1],
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
  return slowest.map(({ id, row }) => {
    const entry: Record<string, number | string> = {
      id,
      totalNs: totalNsSamples[row],
      heapDelta: heapDeltaSamples[row],
      interArrivalNs: interArrivalSamples[row],
    }

    for (const p of slowestPhases) {
      entry[`${p}Ns`] = phaseSamples[p][row]
    }

    entry.scannedBuckets = counterSamples.scannedBuckets[row]
    entry.scannedVectors = counterSamples.scannedVectors[row]

    return entry
  })
}

function emit() {
  const phases: Record<string, ReturnType<typeof summarize>> = {
    totalNs: summarize(totalNsSamples, sampleCount),
  }

  for (const p of PHASES) {
    phases[`${p}Ns`] = summarize(phaseSamples[p], sampleCount)
  }

  phases.scannedVectors = summarize(counterSamples.scannedVectors, sampleCount)
  phases.scannedBuckets = summarize(counterSamples.scannedBuckets, sampleCount)

  const vpb = new Float64Array(sampleCount)

  for (let i = 0; i < sampleCount; i++) {
    const sb = counterSamples.scannedBuckets[i]

    vpb[i] = sb > 0 ? counterSamples.scannedVectors[i] / sb : 0
  }

  phases.vectorsPerBucket = summarize(vpb, sampleCount)

  console.log(
    `__profile__ ${JSON.stringify({
      requests: sampleCount,
      phases,
      counters: counterAverages(),
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
  set,
  snapshot,
})
