import { CONSTANTS } from '@Config/constants'
import fixtures from '../data/test-data.json'
import { measure } from '../src/profiling'
import { Scoring } from '../src/scoring'

const phaseNames = [
  'total',
  'parse',
  'vectorize',
  'quantize',
  'search',
  'selectFine',
  'bbox',
  'scan',
] as const

const counterNames = [
  'selectedBuckets',
  'scannedBuckets',
  'skippedBuckets',
  'scannedVectors',
] as const

type PhaseName = (typeof phaseNames)[number]
type CounterName = (typeof counterNames)[number]
type Phase = Record<PhaseName, number>
type Counter = Record<CounterName, number>

const limit = Number(Bun.argv[2] ?? fixtures.entries.length)
const entries = fixtures.entries.slice(0, limit)

const phases: Record<PhaseName, number[]> = {
  total: [],
  parse: [],
  vectorize: [],
  quantize: [],
  search: [],
  selectFine: [],
  bbox: [],
  scan: [],
}

const counters: Record<CounterName, number[]> = {
  selectedBuckets: [],
  scannedBuckets: [],
  skippedBuckets: [],
  scannedVectors: [],
}

const slowest: ({
  id: string
  fraudCount: number
  expectedFraudCount: number
} & Phase &
  Counter)[] = []

function ms(ns: number) {
  return ns / 1e6
}

function summarize(values: number[]) {
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
  measure.begin(entry.request.id)

  const fraudCount = Scoring.fraudCount(entry.request)

  measure.finish()

  const profile = measure.snapshot()

  const phase = Object.fromEntries(
    phaseNames.map((name) => [name, ms(profile[`${name}Ns`])])
  ) as Phase

  const counter = Object.fromEntries(
    counterNames.map((name) => [name, profile[name]])
  ) as Counter

  const expectedFraudCount = Math.round(
    entry.expected_fraud_score * CONSTANTS.TOP_K
  )

  for (const name of phaseNames) {
    phases[name].push(phase[name])
  }

  for (const name of counterNames) {
    counters[name].push(counter[name])
  }

  slowest.push({
    id: entry.request.id,
    ...phase,
    ...counter,
    fraudCount,
    expectedFraudCount,
  })
}

slowest.sort((a, b) => b.total - a.total)

console.log(
  JSON.stringify({
    count: entries.length,
    phases: Object.fromEntries(
      phaseNames.map((name) => [name, summarize(phases[name])])
    ),
    counters: Object.fromEntries(
      counterNames.map((name) => [name, summarize(counters[name])])
    ),
    slowest: slowest.slice(0, 20),
  })
)
