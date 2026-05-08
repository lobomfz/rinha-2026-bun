import { readFileSync } from 'node:fs'

interface SearchProfile {
  fraudCount: number
  totalNs: number
  parseNs: number
  vectorizeNs: number
  quantizeNs: number
  searchNs: number
  selectFineNs: number
  bboxNs: number
  scanNs: number
  selectedBuckets: number
  scannedBuckets: number
  skippedBuckets: number
  scannedVectors: number
}

type PhaseName =
  | 'parse'
  | 'vectorize'
  | 'quantize'
  | 'search'
  | 'selectFine'
  | 'bbox'
  | 'scan'
type CounterName =
  | 'selectedBuckets'
  | 'scannedBuckets'
  | 'skippedBuckets'
  | 'scannedVectors'
  | 'fraudCount'

interface SlowestEntry {
  id: string
  totalNs: number
  parseNs: number
  searchNs: number
  selectFineNs: number
  bboxNs: number
  scanNs: number
  scannedBuckets: number
  scannedVectors: number
}

interface CgroupStat {
  nr_periods: number
  nr_throttled: number
  throttled_usec: number
}

const SAMPLE_CAPACITY = 256_000
const SLOWEST_CAPACITY = 20

let current: SearchProfile = emptyProfile()
let last: SearchProfile = emptyProfile()
let startedAt = 0
let currentId = ''

const totalNsSamples = new Float64Array(SAMPLE_CAPACITY)
const parseNsSamples = new Float64Array(SAMPLE_CAPACITY)
const searchNsSamples = new Float64Array(SAMPLE_CAPACITY)
const scanNsSamples = new Float64Array(SAMPLE_CAPACITY)
const scannedVectorsSamples = new Float64Array(SAMPLE_CAPACITY)
const scannedBucketsSamples = new Float64Array(SAMPLE_CAPACITY)
const vectorsPerBucketSamples = new Float64Array(SAMPLE_CAPACITY)
let sampleCount = 0

let selectedBucketsSum = 0
let scannedBucketsSum = 0
let skippedBucketsSum = 0
let fraudCountSum = 0

const slowest: SlowestEntry[] = []

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

function emptyProfile(): SearchProfile {
  return {
    fraudCount: 0,
    totalNs: 0,
    parseNs: 0,
    vectorizeNs: 0,
    quantizeNs: 0,
    searchNs: 0,
    selectFineNs: 0,
    bboxNs: 0,
    scanNs: 0,
    selectedBuckets: 0,
    scannedBuckets: 0,
    skippedBuckets: 0,
    scannedVectors: 0,
  }
}

function runMeasure(
  name: PhaseName,
  fn: () => number,
  resultName: CounterName
): number
function runMeasure<T>(name: PhaseName, fn: () => T): T
function runMeasure<T>(name: PhaseName, fn: () => T, resultName?: CounterName) {
  const startedAt = Bun.nanoseconds()
  const result = fn()
  add(name, Bun.nanoseconds() - startedAt)

  if (resultName) {
    if (typeof result !== 'number') {
      throw new TypeError('measured result must be a number to be saved')
    }

    set(resultName, result)
  }

  return result
}

function count(name: CounterName, value = 1) {
  addCounter(name, value)
}

function begin(id: string) {
  currentId = id
  startedAt = Bun.nanoseconds()
  current = emptyProfile()
}

function identify(id: string) {
  currentId = id
}

function add(name: PhaseName, elapsedNs: number) {
  switch (name) {
    case 'parse':
      current.parseNs += elapsedNs
      return
    case 'vectorize':
      current.vectorizeNs += elapsedNs
      return
    case 'quantize':
      current.quantizeNs += elapsedNs
      return
    case 'search':
      current.searchNs += elapsedNs
      return
    case 'selectFine':
      current.selectFineNs += elapsedNs
      return
    case 'bbox':
      current.bboxNs += elapsedNs
      return
    case 'scan':
      current.scanNs += elapsedNs
  }
}

function set(name: CounterName, value: number) {
  switch (name) {
    case 'selectedBuckets':
      current.selectedBuckets = value
      return
    case 'scannedBuckets':
      current.scannedBuckets = value
      return
    case 'skippedBuckets':
      current.skippedBuckets = value
      return
    case 'scannedVectors':
      current.scannedVectors = value
      return
    case 'fraudCount':
      current.fraudCount = value
  }
}

function addCounter(name: CounterName, value: number) {
  switch (name) {
    case 'selectedBuckets':
      current.selectedBuckets += value
      return
    case 'scannedBuckets':
      current.scannedBuckets += value
      return
    case 'skippedBuckets':
      current.skippedBuckets += value
      return
    case 'scannedVectors':
      current.scannedVectors += value
      return
    case 'fraudCount':
      current.fraudCount += value
  }
}

function finish() {
  current.totalNs = Bun.nanoseconds() - startedAt
  last = { ...current }
  aggregate(currentId, current)
}

function aggregate(id: string, profile: SearchProfile) {
  if (sampleCount < SAMPLE_CAPACITY) {
    totalNsSamples[sampleCount] = profile.totalNs
    parseNsSamples[sampleCount] = profile.parseNs
    searchNsSamples[sampleCount] = profile.searchNs
    scanNsSamples[sampleCount] = profile.scanNs
    scannedVectorsSamples[sampleCount] = profile.scannedVectors
    scannedBucketsSamples[sampleCount] = profile.scannedBuckets
    vectorsPerBucketSamples[sampleCount] =
      profile.scannedBuckets > 0
        ? profile.scannedVectors / profile.scannedBuckets
        : 0
    sampleCount++
  }

  selectedBucketsSum += profile.selectedBuckets
  scannedBucketsSum += profile.scannedBuckets
  skippedBucketsSum += profile.skippedBuckets
  fraudCountSum += profile.fraudCount

  insertSlowest(id, profile)
}

function slim(id: string, profile: SearchProfile): SlowestEntry {
  return {
    id,
    totalNs: profile.totalNs,
    parseNs: profile.parseNs,
    searchNs: profile.searchNs,
    selectFineNs: profile.selectFineNs,
    bboxNs: profile.bboxNs,
    scanNs: profile.scanNs,
    scannedBuckets: profile.scannedBuckets,
    scannedVectors: profile.scannedVectors,
  }
}

function insertSlowest(id: string, profile: SearchProfile) {
  if (slowest.length < SLOWEST_CAPACITY) {
    slowest.push(slim(id, profile))
  } else if (profile.totalNs > slowest[SLOWEST_CAPACITY - 1].totalNs) {
    slowest[SLOWEST_CAPACITY - 1] = slim(id, profile)
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

function summarize(samples: Float64Array, count: number) {
  if (count === 0) {
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }

  const sorted = samples.slice(0, count).sort()
  let sum = 0

  for (let i = 0; i < count; i++) {
    sum += sorted[i]
  }

  return {
    count,
    mean: Math.round(sum / count),
    p50: sorted[Math.floor(count * 0.5)],
    p95: sorted[Math.floor(count * 0.95)],
    p99: sorted[Math.floor(count * 0.99)],
    max: sorted[count - 1],
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function counterAverages() {
  if (sampleCount === 0) {
    return {
      selectedBuckets: 0,
      scannedBuckets: 0,
      skippedBuckets: 0,
      fraudCount: 0,
    }
  }

  return {
    selectedBuckets: round2(selectedBucketsSum / sampleCount),
    scannedBuckets: round2(scannedBucketsSum / sampleCount),
    skippedBuckets: round2(skippedBucketsSum / sampleCount),
    fraudCount: round2(fraudCountSum / sampleCount),
  }
}

function snapshot() {
  return last
}

function emit() {
  console.log(
    `__profile__ ${JSON.stringify({
      requests: sampleCount,
      phases: {
        totalNs: summarize(totalNsSamples, sampleCount),
        parseNs: summarize(parseNsSamples, sampleCount),
        searchNs: summarize(searchNsSamples, sampleCount),
        scanNs: summarize(scanNsSamples, sampleCount),
        scannedVectors: summarize(scannedVectorsSamples, sampleCount),
        scannedBuckets: summarize(scannedBucketsSamples, sampleCount),
        vectorsPerBucket: summarize(vectorsPerBucketSamples, sampleCount),
      },
      counters: counterAverages(),
      cgroup: cgroupDelta(),
      slowest,
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
  set,
  snapshot,
})
