interface SearchProfile {
  fraudCount: number
  totalNs: number
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

let current: SearchProfile = emptyProfile()
let last: SearchProfile = emptyProfile()
let startedAt = 0

function emptyProfile(): SearchProfile {
  return {
    fraudCount: 0,
    totalNs: 0,
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

function begin() {
  startedAt = Bun.nanoseconds()
  current = emptyProfile()
}

function add(name: PhaseName, elapsedNs: number) {
  switch (name) {
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
}

function snapshot() {
  return last
}

export const measure = Object.assign(runMeasure, {
  add,
  addCounter,
  begin,
  count,
  finish,
  set,
  snapshot,
})
