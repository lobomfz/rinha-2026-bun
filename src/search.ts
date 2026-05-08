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
const fineDistances = new Float64Array(fineLimit)
const fineOrder = new Uint16Array(fineLimit)
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
    let selected = 0

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const offset = fine * CONSTANTS.DIMS
      let distance = 0

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        const diff = query[dim] - fineCentroids[offset + dim]

        distance += diff * diff
      }

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

  scanFine(query: Int16Array, start: number, end: number, label: number) {
    let worstTop = topDistances[CONSTANTS.TOP_K - 1]

    for (let i = start; i < end; i++) {
      const base = i * CONSTANTS.DIMS

      let distance = 0

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        const diff = query[dim] - vectors[base + dim]

        distance += diff * diff

        if (distance >= worstTop) {
          break
        }
      }

      if (distance >= worstTop) {
        continue
      }

      let slot = CONSTANTS.TOP_K - 1

      while (slot > 0 && topDistances[slot - 1] > distance) {
        topDistances[slot] = topDistances[slot - 1]
        topLabels[slot] = topLabels[slot - 1]
        slot--
      }

      topDistances[slot] = distance
      topLabels[slot] = label
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

    for (let i = 0; i < selected; i++) {
      const fine = fineOrder[i]
      const start = fineOffsets[fine]
      const fraudEnd = fineFraudEnd[fine]
      const end = fineOffsets[fine + 1]

      if (start === end) {
        measure.count('skippedBuckets')
        continue
      }

      const lowerBound = measure('bbox', () =>
        Search.bboxLowerBound(query, fine)
      )

      if (lowerBound >= topDistances[CONSTANTS.TOP_K - 1]) {
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
