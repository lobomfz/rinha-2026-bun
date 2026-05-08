import fixtures from '../data/test-data.json'
import { CONSTANTS } from '@Config/constants'
import { Scoring } from '../src/scoring'
import { Search } from '../src/search'
import type { Payload } from '../src/types'
import { Vectorize } from '../src/vectorize'

type Entry = {
  request: Payload
  expected_approved: boolean
  expected_fraud_score: number
}

type Fixtures = { entries: Entry[] }

type Stats = {
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

const vector = new Float32Array(CONSTANTS.DIMS)
const query = new Int16Array(CONSTANTS.DIMS)
const limit = Number(Bun.argv[2] ?? (fixtures as Fixtures).entries.length)
const entries = (fixtures as Fixtures).entries.slice(0, limit)

const total = [] as number[]
const vectorize = [] as number[]
const quantize = [] as number[]
const selectFine = [] as number[]
const bbox = [] as number[]
const scan = [] as number[]
const search = [] as number[]
const selectedBuckets = [] as number[]
const scannedBuckets = [] as number[]
const skippedBuckets = [] as number[]
const scannedVectors = [] as number[]
const slowest = [] as {
  id: string
  total: number
  vectorize: number
  quantize: number
  search: number
  selectFine: number
  bbox: number
  scan: number
  selectedBuckets: number
  scannedBuckets: number
  skippedBuckets: number
  scannedVectors: number
  fraudCount: number
  expectedFraudCount: number
}[]

function milliseconds(ns: number): number {
  return ns / 1e6
}

function summarize(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b)
  let sum = 0

  for (const value of sorted) {
    sum += value
  }

  return {
    mean: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    max: sorted.at(-1)!,
  }
}

for (const entry of entries) {
  const totalStartedAt = Bun.nanoseconds()

  const vectorizeStartedAt = Bun.nanoseconds()
  Vectorize.transform(entry.request, vector)
  const vectorizeMs = milliseconds(Bun.nanoseconds() - vectorizeStartedAt)

  const quantizeStartedAt = Bun.nanoseconds()
  Scoring.quantize(vector, query)
  const quantizeMs = milliseconds(Bun.nanoseconds() - quantizeStartedAt)

  const searchStartedAt = Bun.nanoseconds()
  const profile = Search.profile(query)
  const searchMs = milliseconds(Bun.nanoseconds() - searchStartedAt)
  const totalMs = milliseconds(Bun.nanoseconds() - totalStartedAt)

  const selectFineMs = milliseconds(profile.selectFineNs)
  const bboxMs = milliseconds(profile.bboxNs)
  const scanMs = milliseconds(profile.scanNs)
  const expectedFraudCount = Math.round(entry.expected_fraud_score * CONSTANTS.TOP_K)

  total.push(totalMs)
  vectorize.push(vectorizeMs)
  quantize.push(quantizeMs)
  search.push(searchMs)
  selectFine.push(selectFineMs)
  bbox.push(bboxMs)
  scan.push(scanMs)
  selectedBuckets.push(profile.selectedBuckets)
  scannedBuckets.push(profile.scannedBuckets)
  skippedBuckets.push(profile.skippedBuckets)
  scannedVectors.push(profile.scannedVectors)

  slowest.push({
    id: entry.request.id,
    total: totalMs,
    vectorize: vectorizeMs,
    quantize: quantizeMs,
    search: searchMs,
    selectFine: selectFineMs,
    bbox: bboxMs,
    scan: scanMs,
    selectedBuckets: profile.selectedBuckets,
    scannedBuckets: profile.scannedBuckets,
    skippedBuckets: profile.skippedBuckets,
    scannedVectors: profile.scannedVectors,
    fraudCount: profile.fraudCount,
    expectedFraudCount,
  })
}

slowest.sort((a, b) => b.total - a.total)

console.log(
  JSON.stringify({
    count: entries.length,
    phases: {
      total: summarize(total),
      vectorize: summarize(vectorize),
      quantize: summarize(quantize),
      search: summarize(search),
      selectFine: summarize(selectFine),
      bbox: summarize(bbox),
      scan: summarize(scan),
    },
    counters: {
      selectedBuckets: summarize(selectedBuckets),
      scannedBuckets: summarize(scannedBuckets),
      skippedBuckets: summarize(skippedBuckets),
      scannedVectors: summarize(scannedVectors),
    },
    slowest: slowest.slice(0, 20),
  })
)
