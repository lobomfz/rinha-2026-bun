import {
  fineBboxes,
  fineCentroids,
  fineFraudEnd,
  fineOffsets,
  vectors,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'
import fixtures from '../../data/test-data.json'
import { Scoring } from '../../src/scoring'
import type { Payload } from '../../src/types'
import { Vectorize } from '../../src/vectorize'

type Entry = { request: Payload }
type Fixtures = { entries: Entry[] }

const FINE_LIMIT = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)

const fineRadii = new Float64Array(CONSTANTS.FINE_COUNT)

for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
  const start = fineOffsets[fine]
  const end = fineOffsets[fine + 1]
  let maxDist = 0

  for (let i = start; i < end; i++) {
    const base = i * CONSTANTS.DIMS
    let dist = 0

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      const c = fineCentroids[dim * CONSTANTS.FINE_COUNT + fine]
      const diff = vectors[base + dim] - c
      dist += diff * diff
    }

    if (dist > maxDist) {
      maxDist = dist
    }
  }

  fineRadii[fine] = Math.sqrt(maxDist)
}

const queries: Int16Array[] = []

{
  const v = new Float32Array(CONSTANTS.DIMS)
  const sample = Math.min(1024, (fixtures as Fixtures).entries.length)

  for (let i = 0; i < sample; i++) {
    const q = new Int16Array(CONSTANTS.DIMS)
    Vectorize.transform((fixtures as Fixtures).entries[i].request, v)
    Scoring.quantize(v, q)
    queries.push(q)
  }
}

function computeCentroidDists(query: Int16Array, out: Float64Array) {
  out.fill(0)

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    const qd = query[dim]
    const base = dim * CONSTANTS.FINE_COUNT

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const diff = qd - fineCentroids[base + fine]
      out[fine] += diff * diff
    }
  }
}

function selectTopFines(
  centroidDists: Float64Array,
  outOrder: Uint16Array,
  outDists: Float64Array
) {
  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const distance = centroidDists[fine]

    if (selected < FINE_LIMIT) {
      let slot = selected
      while (slot > 0 && outDists[slot - 1] > distance) {
        outDists[slot] = outDists[slot - 1]
        outOrder[slot] = outOrder[slot - 1]
        slot--
      }
      outDists[slot] = distance
      outOrder[slot] = fine
      selected++
      continue
    }

    if (distance >= outDists[FINE_LIMIT - 1]) {
      continue
    }

    let slot = FINE_LIMIT - 1
    while (slot > 0 && outDists[slot - 1] > distance) {
      outDists[slot] = outDists[slot - 1]
      outOrder[slot] = outOrder[slot - 1]
      slot--
    }
    outDists[slot] = distance
    outOrder[slot] = fine
  }

  return selected
}

function bboxLb(query: Int16Array, fine: number) {
  const offset = fine * CONSTANTS.DIMS * 2
  let distance = 0

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    const value = query[dim]
    const min = fineBboxes[offset + dim * 2]
    const max = fineBboxes[offset + dim * 2 + 1]

    if (value < min) {
      const diff = min - value
      distance += diff * diff
      continue
    }

    if (value > max) {
      const diff = value - max
      distance += diff * diff
    }
  }

  return distance
}

function radiusLb(centroidDistSq: number, fine: number) {
  const centroidDist = Math.sqrt(centroidDistSq)
  const radius = fineRadii[fine]

  if (centroidDist <= radius) {
    return 0
  }

  const gap = centroidDist - radius
  return gap * gap
}

const topDistances = new Float64Array(CONSTANTS.TOP_K)

function resetTop() {
  for (let k = 0; k < CONSTANTS.TOP_K; k++) {
    topDistances[k] = Infinity
  }
}

function insertTop(distance: number) {
  let slot = CONSTANTS.TOP_K - 1

  while (slot > 0 && topDistances[slot - 1] > distance) {
    topDistances[slot] = topDistances[slot - 1]
    slot--
  }

  topDistances[slot] = distance
}

function scanBucket(query: Int16Array, start: number, end: number) {
  for (let i = start; i < end; i++) {
    const base = i * CONSTANTS.DIMS
    let distance = 0

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      const diff = query[dim] - vectors[base + dim]
      distance += Math.imul(diff, diff)
    }

    if (distance < topDistances[CONSTANTS.TOP_K - 1]) {
      insertTop(distance)
    }
  }
}

type Strategy = 'none' | 'bbox' | 'radius' | 'combined'

const lbBuffer = new Float64Array(FINE_LIMIT)
const orderCopy = new Uint16Array(FINE_LIMIT)

function simulate(
  query: Int16Array,
  strategy: Strategy,
  selected: number,
  fineOrder: Uint16Array,
  fineCentroidDists: Float64Array
) {
  resetTop()

  for (let i = 0; i < selected; i++) {
    const fine = fineOrder[i]

    if (strategy === 'none') {
      lbBuffer[i] = 0
      continue
    }

    const bbox = strategy === 'radius' ? 0 : bboxLb(query, fine)
    const rad =
      strategy === 'bbox' ? 0 : radiusLb(fineCentroidDists[fine], fine)

    lbBuffer[i] = strategy === 'combined' ? Math.max(bbox, rad) : bbox + rad
  }

  for (let i = 0; i < selected; i++) {
    orderCopy[i] = fineOrder[i]
  }

  let bucketsScanned = 0
  let vectorsScanned = 0

  for (let i = 0; i < selected; i++) {
    let minIdx = i
    let minLb = lbBuffer[i]

    for (let j = i + 1; j < selected; j++) {
      if (lbBuffer[j] < minLb) {
        minLb = lbBuffer[j]
        minIdx = j
      }
    }

    if (minLb >= topDistances[CONSTANTS.TOP_K - 1]) {
      break
    }

    if (minIdx !== i) {
      lbBuffer[minIdx] = lbBuffer[i]
      lbBuffer[i] = minLb
      const tmp = orderCopy[i]
      orderCopy[i] = orderCopy[minIdx]
      orderCopy[minIdx] = tmp
    }

    const fine = orderCopy[i]
    const start = fineOffsets[fine]
    const end = fineOffsets[fine + 1]

    if (start === end) {
      continue
    }

    scanBucket(query, start, end)

    bucketsScanned++
    vectorsScanned += end - start
  }

  return { bucketsScanned, vectorsScanned }
}

function summarize(label: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / sorted.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const max = sorted.at(-1)

  console.log(
    `  ${label.padEnd(10)}  mean=${mean.toFixed(1).padStart(8)}  p50=${String(p50).padStart(6)}  p95=${String(p95).padStart(6)}  p99=${String(p99).padStart(6)}  max=${String(max).padStart(6)}`
  )
}

const strategies: Strategy[] = ['none', 'bbox', 'radius', 'combined']
const results: Record<Strategy, { buckets: number[]; vectors: number[] }> = {
  none: { buckets: [], vectors: [] },
  bbox: { buckets: [], vectors: [] },
  radius: { buckets: [], vectors: [] },
  combined: { buckets: [], vectors: [] },
}

const centroidDists = new Float64Array(CONSTANTS.FINE_COUNT)
const fineOrder = new Uint16Array(FINE_LIMIT)
const fineDists = new Float64Array(FINE_LIMIT)

for (const query of queries) {
  computeCentroidDists(query, centroidDists)
  const selected = selectTopFines(centroidDists, fineOrder, fineDists)

  for (const strategy of strategies) {
    const r = simulate(query, strategy, selected, fineOrder, centroidDists)
    results[strategy].buckets.push(r.bucketsScanned)
    results[strategy].vectors.push(r.vectorsScanned)
  }
}

console.log(
  `\nlb effectiveness over ${queries.length} queries (FINE_COUNT=${CONSTANTS.FINE_COUNT}, FINE_PROBE=${FINE_LIMIT}, TOP_K=${CONSTANTS.TOP_K})\n`
)

console.log('buckets scanned:')
for (const strategy of strategies) {
  summarize(strategy, results[strategy].buckets)
}

console.log('\nvectors scanned:')
for (const strategy of strategies) {
  summarize(strategy, results[strategy].vectors)
}

let totalRadius = 0
let countRadius = 0

for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
  const start = fineOffsets[fine]
  const end = fineOffsets[fine + 1]
  if (start === end) {
    continue
  }
  totalRadius += fineRadii[fine]
  countRadius++
}

console.log(
  `\navg cluster radius (sqrt dist²): ${(totalRadius / countRadius).toFixed(1)}, populated buckets: ${countRadius}/${CONSTANTS.FINE_COUNT}`
)
