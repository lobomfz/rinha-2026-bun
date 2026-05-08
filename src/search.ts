import {
  fineBboxes,
  fineCentroids,
  fineFraudEnd,
  fineOffsets,
  vectors,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'
import { measure } from './profiling'

const fineLimit = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)
const fineAllDistances = new Float64Array(CONSTANTS.FINE_COUNT)
const fineDistances = new Float64Array(fineLimit)
const fineOrder = new Uint16Array(fineLimit)
const bboxLowerBounds = new Float64Array(fineLimit)
const topDistances = new Float64Array(CONSTANTS.TOP_K)
const topLabels = new Uint8Array(CONSTANTS.TOP_K)

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

  insertSelectedFine(distance: number, fine: number, slot: number) {
    while (slot > 0 && fineDistances[slot - 1] > distance) {
      fineDistances[slot] = fineDistances[slot - 1]
      fineOrder[slot] = fineOrder[slot - 1]
      slot--
    }

    fineDistances[slot] = distance
    fineOrder[slot] = fine
  },

  selectFine(query: Int16Array) {
    {
      const qd = query[0]

      for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
        const diff = qd - fineCentroids[fine]

        fineAllDistances[fine] = diff * diff
      }
    }

    for (let dim = 1; dim < CONSTANTS.DIMS; dim++) {
      const qd = query[dim]
      const dimBase = dim * CONSTANTS.FINE_COUNT

      for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
        const diff = qd - fineCentroids[dimBase + fine]

        fineAllDistances[fine] += diff * diff
      }
    }

    let selected = 0

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const distance = fineAllDistances[fine]

      if (selected < fineLimit) {
        const slot = selected
        selected++
        Search.insertSelectedFine(distance, fine, slot)
        continue
      }

      if (distance >= fineDistances[fineLimit - 1]) {
        continue
      }

      Search.insertSelectedFine(distance, fine, fineLimit - 1)
    }

    return selected
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

  computeBboxBounds(query: Int16Array, selected: number) {
    for (let i = 0; i < selected; i++) {
      bboxLowerBounds[i] = Search.bboxLowerBound(query, fineOrder[i])
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
        continue
      }

      diff = q12 - vectors[base + 12]
      distance += Math.imul(diff, diff)
      diff = q13 - vectors[base + 13]
      distance += Math.imul(diff, diff)

      if (distance >= worstTop) {
        continue
      }

      Search.insertTop(distance, label)

      worstTop = topDistances[CONSTANTS.TOP_K - 1]
    }
  },

  knn(query: Int16Array) {
    Search.resetTop()

    const selected = measure(
      'selectFine',
      () => Search.selectFine(query),
      'selectedBuckets'
    )

    measure('bbox', () => Search.computeBboxBounds(query, selected))

    for (let i = 0; i < selected; i++) {
      let minIdx = i

      let minLb = bboxLowerBounds[i]

      for (let j = i + 1; j < selected; j++) {
        if (bboxLowerBounds[j] < minLb) {
          minLb = bboxLowerBounds[j]
          minIdx = j
        }
      }

      if (minLb >= topDistances[CONSTANTS.TOP_K - 1]) {
        measure.count('skippedBuckets', selected - i)
        break
      }

      if (minIdx !== i) {
        bboxLowerBounds[minIdx] = bboxLowerBounds[i]
        bboxLowerBounds[i] = minLb

        const tmp = fineOrder[i]
        fineOrder[i] = fineOrder[minIdx]
        fineOrder[minIdx] = tmp
      }

      const fine = fineOrder[i]
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
    }

    return Search.fraudCount()
  },
}
