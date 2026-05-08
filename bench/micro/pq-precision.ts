import {
  fineCentroids,
  pqCodes,
  pqSubCentroids,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'
import fixtures from '../../data/test-data.json'
import { Scoring } from '../../src/scoring'
import type { Payload } from '../../src/types'
import { Vectorize } from '../../src/vectorize'

type Entry = { request: Payload }
type Fixtures = { entries: Entry[] }

const FINE_LIMIT = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)

function exactDistances(query: Int16Array, out: Float64Array) {
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

const pqLut = new Float64Array(CONSTANTS.PQ_M * CONSTANTS.PQ_K)

function pqDistances(query: Int16Array, out: Float64Array) {
  for (let sub = 0; sub < CONSTANTS.PQ_M; sub++) {
    const subBase = sub * CONSTANTS.PQ_K * CONSTANTS.PQ_SUB_DIM
    const lutBase = sub * CONSTANTS.PQ_K
    const dim0 = sub * CONSTANTS.PQ_SUB_DIM
    const q0 = query[dim0]
    const q1 = query[dim0 + 1]

    for (let code = 0; code < CONSTANTS.PQ_K; code++) {
      const cBase = subBase + code * CONSTANTS.PQ_SUB_DIM
      const d0 = q0 - pqSubCentroids[cBase]
      const d1 = q1 - pqSubCentroids[cBase + 1]

      pqLut[lutBase + code] = d0 * d0 + d1 * d1
    }
  }

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const codeBase = fine * CONSTANTS.PQ_M
    let dist = pqLut[pqCodes[codeBase]]

    for (let sub = 1; sub < CONSTANTS.PQ_M; sub++) {
      dist += pqLut[sub * CONSTANTS.PQ_K + pqCodes[codeBase + sub]]
    }

    out[fine] = dist
  }
}

function topK(distances: Float64Array, k: number): Set<number> {
  const idxs = new Uint16Array(CONSTANTS.FINE_COUNT)
  for (let i = 0; i < CONSTANTS.FINE_COUNT; i++) idxs[i] = i

  const sorted = Array.from(idxs).sort((a, b) => distances[a] - distances[b])
  return new Set(sorted.slice(0, k))
}

const queries: Int16Array[] = []

{
  const v = new Float32Array(CONSTANTS.DIMS)
  const sample = Math.min(512, (fixtures as Fixtures).entries.length)

  for (let i = 0; i < sample; i++) {
    const q = new Int16Array(CONSTANTS.DIMS)
    Vectorize.transform((fixtures as Fixtures).entries[i].request, v)
    Scoring.quantize(v, q)
    queries.push(q)
  }
}

const exact = new Float64Array(CONSTANTS.FINE_COUNT)
const pq = new Float64Array(CONSTANTS.FINE_COUNT)

const overlapsByLimit: Record<number, number[]> = {}
const limits = [5, 32, 64, 128]

for (const limit of limits) overlapsByLimit[limit] = []

let relativeErrSum = 0
let relativeErrCount = 0

for (const query of queries) {
  exactDistances(query, exact)
  pqDistances(query, pq)

  for (const limit of limits) {
    const exactTop = topK(exact, limit)
    const pqTop = topK(pq, limit)

    let overlap = 0
    for (const f of pqTop) if (exactTop.has(f)) overlap++

    overlapsByLimit[limit].push(overlap / limit)
  }

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    if (exact[fine] > 0) {
      const err = Math.abs(pq[fine] - exact[fine]) / exact[fine]
      relativeErrSum += err
      relativeErrCount++
    }
  }
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p05 = sorted[Math.floor(sorted.length * 0.05)]
  const min = sorted[0]
  return { mean, p50, p05, min }
}

console.log(
  `\nPQ precision over ${queries.length} queries (FINE_COUNT=${CONSTANTS.FINE_COUNT}, PQ_M=${CONSTANTS.PQ_M}, PQ_K=${CONSTANTS.PQ_K}):\n`
)

console.log('top-K overlap (PQ vs exact):')
for (const limit of limits) {
  const s = summarize(overlapsByLimit[limit])
  console.log(
    `  k=${String(limit).padStart(3)}  mean=${(s.mean * 100).toFixed(1)}%  p50=${(s.p50 * 100).toFixed(1)}%  p05=${(s.p05 * 100).toFixed(1)}%  min=${(s.min * 100).toFixed(1)}%`
  )
}

console.log(
  `\navg relative error of PQ dist² vs exact: ${((relativeErrSum / relativeErrCount) * 100).toFixed(2)}%`
)
