import {
  fineBboxes,
  fineFraudEnd,
  fineOffsets,
  fineRadii,
  pqCodes,
  pqSubCentroids,
  vectors,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'
import { measure } from './profiling'

const fineLimit = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)
const fastFineLimit = Math.min(CONSTANTS.FAST_FINE_PROBE, fineLimit)
const fineDistances = new Float64Array(fineLimit)
const fineDistanceCache = new Float64Array(CONSTANTS.FINE_COUNT)
const fineOrder = new Uint16Array(fineLimit)
const lowerBounds = new Float64Array(fineLimit)
const scannedFineMarks = new Uint32Array(CONSTANTS.FINE_COUNT)
let scanGeneration = 0
const topDistances = new Float64Array(CONSTANTS.TOP_K)
const topLabels = new Uint8Array(CONSTANTS.TOP_K)
const pqLut = new Float64Array(CONSTANTS.PQ_M * CONSTANTS.PQ_K)

export const Search = {
  size: vectors.length / CONSTANTS.DIMS,

  warmup(iterations: number) {
    if (iterations <= 0) {
      return
    }

    const totalVectors = vectors.length / CONSTANTS.DIMS

    const stride = Math.max(1, Math.floor(totalVectors / iterations))

    for (let i = 0; i < iterations; i++) {
      const idx = (i * stride) % totalVectors

      Search.knn(
        vectors.subarray(
          idx * CONSTANTS.DIMS,
          idx * CONSTANTS.DIMS + CONSTANTS.DIMS
        )
      )
    }
  },

  resetTop() {
    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      topDistances[k] = Infinity
      topLabels[k] = 0
    }
  },

  fraudCount() {
    let fraudCount = 0

    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      fraudCount += topLabels[k]
    }

    return fraudCount
  },

  heapSiftDown(end: number) {
    let i = 0

    while (true) {
      const left = 2 * i + 1

      if (left >= end) {
        break
      }

      let largest = i

      if (fineDistances[left] > fineDistances[largest]) {
        largest = left
      }

      const right = left + 1

      if (right < end && fineDistances[right] > fineDistances[largest]) {
        largest = right
      }

      if (largest === i) {
        break
      }

      const td = fineDistances[i]
      fineDistances[i] = fineDistances[largest]
      fineDistances[largest] = td

      const to = fineOrder[i]
      fineOrder[i] = fineOrder[largest]
      fineOrder[largest] = to

      i = largest
    }
  },

  heapBuild(end: number) {
    for (let start = (end >> 1) - 1; start >= 0; start--) {
      let i = start

      while (true) {
        const left = 2 * i + 1

        if (left >= end) {
          break
        }

        let largest = i

        if (fineDistances[left] > fineDistances[largest]) {
          largest = left
        }

        const right = left + 1

        if (right < end && fineDistances[right] > fineDistances[largest]) {
          largest = right
        }

        if (largest === i) {
          break
        }

        const td = fineDistances[i]
        fineDistances[i] = fineDistances[largest]
        fineDistances[largest] = td

        const to = fineOrder[i]
        fineOrder[i] = fineOrder[largest]
        fineOrder[largest] = to

        i = largest
      }
    }
  },

  selectFineLut(query: Int16Array) {
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
  },

  selectFineHeapInit(limit: number, cacheDistances: boolean) {
    for (let fine = 0; fine < limit; fine++) {
      const codeBase = fine * CONSTANTS.PQ_M
      let dist = pqLut[pqCodes[codeBase]]

      for (let sub = 1; sub < CONSTANTS.PQ_M; sub++) {
        dist += pqLut[sub * CONSTANTS.PQ_K + pqCodes[codeBase + sub]]
      }

      if (cacheDistances) {
        fineDistanceCache[fine] = dist
      }

      fineDistances[fine] = dist
      fineOrder[fine] = fine
    }
  },

  selectFineHeapMain(limit: number, cacheDistances: boolean) {
    for (let fine = limit; fine < CONSTANTS.FINE_COUNT; fine++) {
      const codeBase = fine * CONSTANTS.PQ_M
      let dist = pqLut[pqCodes[codeBase]]

      for (let sub = 1; sub < CONSTANTS.PQ_M; sub++) {
        dist += pqLut[sub * CONSTANTS.PQ_K + pqCodes[codeBase + sub]]
      }

      if (cacheDistances) {
        fineDistanceCache[fine] = dist
      }

      if (dist < fineDistances[0]) {
        fineDistances[0] = dist
        fineOrder[0] = fine
        Search.heapSiftDown(limit)
      }
    }
  },

  selectFine(query: Int16Array, limit: number, buildLut: boolean) {
    if (buildLut) {
      measure('sfLut', () => Search.selectFineLut(query))
    }

    measure('sfInit', () => Search.selectFineHeapInit(limit, buildLut))
    measure('sfBuild', () => Search.heapBuild(limit))
    measure('sfMain', () => Search.selectFineHeapMain(limit, buildLut))

    return limit
  },

  selectFineCachedInit(limit: number) {
    for (let fine = 0; fine < limit; fine++) {
      fineDistances[fine] = fineDistanceCache[fine]
      fineOrder[fine] = fine
    }
  },

  selectFineCachedMain(limit: number) {
    for (let fine = limit; fine < CONSTANTS.FINE_COUNT; fine++) {
      const dist = fineDistanceCache[fine]

      if (dist < fineDistances[0]) {
        fineDistances[0] = dist
        fineOrder[0] = fine
        Search.heapSiftDown(limit)
      }
    }
  },

  selectFineCached(limit: number) {
    measure('sfInit', () => Search.selectFineCachedInit(limit))
    measure('sfBuild', () => Search.heapBuild(limit))
    measure('sfMain', () => Search.selectFineCachedMain(limit))

    return limit
  },

  bboxLowerBound(query: Int16Array, fine: number) {
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
  },

  computeLowerBounds(query: Int16Array, selected: number) {
    for (let i = 0; i < selected; i++) {
      const fine = fineOrder[i]
      const bbox = Search.bboxLowerBound(query, fine)
      const centroidDist = Math.sqrt(fineDistances[i])
      const radius = fineRadii[fine]

      let radLb = 0

      if (centroidDist > radius) {
        const gap = centroidDist - radius

        radLb = gap * gap
      }

      lowerBounds[i] = bbox > radLb ? bbox : radLb
    }
  },

  insertTop(distance: number, label: number) {
    let slot = CONSTANTS.TOP_K - 1

    while (slot > 0 && topDistances[slot - 1] > distance) {
      topDistances[slot] = topDistances[slot - 1]
      topLabels[slot] = topLabels[slot - 1]
      slot--
    }

    topDistances[slot] = distance
    topLabels[slot] = label
  },

  scanFine(query: Int16Array, start: number, end: number, label: number) {
    const q0 = query[0]
    const q1 = query[1]
    const q2 = query[2]
    const q3 = query[3]
    const q4 = query[4]
    const q5 = query[5]
    const q6 = query[6]
    const q7 = query[7]
    const q8 = query[8]
    const q9 = query[9]
    const q10 = query[10]
    const q11 = query[11]
    const q12 = query[12]
    const q13 = query[13]

    let worstTop = topDistances[CONSTANTS.TOP_K - 1]

    for (let i = start; i < end; i++) {
      const base = i * CONSTANTS.DIMS

      const d0 = q0 - vectors[base]
      const d1 = q1 - vectors[base + 1]
      const d2 = q2 - vectors[base + 2]
      const d3 = q3 - vectors[base + 3]

      let distance =
        Math.imul(d0, d0) +
        Math.imul(d1, d1) +
        Math.imul(d2, d2) +
        Math.imul(d3, d3)

      if (distance >= worstTop) {
        measure.count('scanExitAtDim4')
        continue
      }

      let diff = q4 - vectors[base + 4]

      distance += Math.imul(diff, diff)
      diff = q5 - vectors[base + 5]
      distance += Math.imul(diff, diff)
      diff = q6 - vectors[base + 6]
      distance += Math.imul(diff, diff)
      diff = q7 - vectors[base + 7]
      distance += Math.imul(diff, diff)

      if (distance >= worstTop) {
        measure.count('scanExitAtDim8')
        continue
      }

      diff = q8 - vectors[base + 8]
      distance += Math.imul(diff, diff)
      diff = q9 - vectors[base + 9]
      distance += Math.imul(diff, diff)
      diff = q10 - vectors[base + 10]
      distance += Math.imul(diff, diff)
      diff = q11 - vectors[base + 11]
      distance += Math.imul(diff, diff)

      if (distance >= worstTop) {
        measure.count('scanExitAtDim12')
        continue
      }

      diff = q12 - vectors[base + 12]
      distance += Math.imul(diff, diff)
      diff = q13 - vectors[base + 13]
      distance += Math.imul(diff, diff)

      if (distance >= worstTop) {
        measure.count('scanExitAtDim14')
        continue
      }

      measure.count('scanExitAtDim14')
      Search.insertTop(distance, label)

      worstTop = topDistances[CONSTANTS.TOP_K - 1]
    }
  },

  scanSelected(
    query: Int16Array,
    selected: number,
    from: number,
    to: number,
    allowClassEarlyExit: boolean,
    scannedMark: number
  ) {
    for (let i = from; i < to; i++) {
      let minIdx = i

      let minLb = lowerBounds[i]

      for (let j = i + 1; j < selected; j++) {
        if (lowerBounds[j] < minLb) {
          minLb = lowerBounds[j]
          minIdx = j
        }
      }

      if (minLb >= topDistances[CONSTANTS.TOP_K - 1]) {
        measure.count('skippedBuckets', selected - i)
        measure.count('knnEarlyExits')
        return selected
      }

      if (minIdx !== i) {
        lowerBounds[minIdx] = lowerBounds[i]
        lowerBounds[i] = minLb

        const tmp = fineOrder[i]
        fineOrder[i] = fineOrder[minIdx]
        fineOrder[minIdx] = tmp
      }

      const fine = fineOrder[i]

      if (scannedFineMarks[fine] === scannedMark) {
        measure.count('skippedBuckets')
        continue
      }

      scannedFineMarks[fine] = scannedMark

      const start = fineOffsets[fine]
      const fraudEnd = fineFraudEnd[fine]
      const end = fineOffsets[fine + 1]

      if (start === end) {
        measure.count('skippedBuckets')
        continue
      }

      if (start < fraudEnd) {
        measure('scan', () => Search.scanFine(query, start, fraudEnd, 1))
      }

      if (fraudEnd < end) {
        measure('scan', () => Search.scanFine(query, fraudEnd, end, 0))
      }

      measure.count('scannedBuckets')
      measure.count('scannedVectors', end - start)

      if (!allowClassEarlyExit) {
        continue
      }

      let currentFraud = 0

      for (let k = 0; k < CONSTANTS.TOP_K; k++) {
        currentFraud += topLabels[k]
      }

      const worstTop = topDistances[CONSTANTS.TOP_K - 1]

      let maxFutureFrauds = 0
      let maxFutureLegits = 0

      for (let j = i + 1; j < selected; j++) {
        if (lowerBounds[j] >= worstTop) {
          continue
        }

        const futureFine = fineOrder[j]

        if (scannedFineMarks[futureFine] === scannedMark) {
          continue
        }

        const futureStart = fineOffsets[futureFine]
        const futureFraudEnd = fineFraudEnd[futureFine]
        const futureEnd = fineOffsets[futureFine + 1]

        maxFutureFrauds += futureFraudEnd - futureStart
        maxFutureLegits += futureEnd - futureFraudEnd
      }

      if (
        currentFraud + maxFutureFrauds < 3 ||
        currentFraud - maxFutureLegits >= 3
      ) {
        measure.count('skippedBuckets', selected - i - 1)
        measure.count('knnEarlyExits')
        return selected
      }
    }

    return to
  },

  knn(query: Int16Array) {
    Search.resetTop()
    scanGeneration++
    const scannedMark = scanGeneration

    const fastSelected = measure('selectFine', () =>
      Search.selectFine(query, fastFineLimit, true)
    )

    {
      measure('lb', () => Search.computeLowerBounds(query, fastSelected))
      Search.scanSelected(query, fastSelected, 0, fastSelected, true, scannedMark)
    }

    const fastFraud = Search.fraudCount()

    if (fastFraud === 0 || fastFraud === 5) {
      measure.count('selectedBuckets', fastSelected)
      measure.count('skippedBuckets', fineLimit - fastSelected)
      measure.count('knnEarlyExits')

      return fastFraud
    }

    const selected = measure('selectFine', () => Search.selectFineCached(fineLimit))

    measure.count('selectedBuckets', selected)

    {
      measure('lb', () => Search.computeLowerBounds(query, selected))
      Search.scanSelected(query, selected, 0, selected, true, scannedMark)
    }

    return Search.fraudCount()
  },
}
