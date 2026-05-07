import {
  fineBboxes,
  fineCentroids,
  fineOffsets,
  labels,
  vectors,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'

const fineLimit = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)
const fineDistances = new Float64Array(fineLimit)
const fineOrder = new Uint16Array(fineLimit)
const topDistances = new Float64Array(CONSTANTS.TOP_K)
const topLabels = new Uint8Array(CONSTANTS.TOP_K)

export const Search = {
  size: labels.length,

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

  scanFine(query: Int16Array, start: number, end: number) {
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
      topLabels[slot] = labels[i]
      worstTop = topDistances[CONSTANTS.TOP_K - 1]
    }
  },

  knn(query: Int16Array) {
    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      topDistances[k] = Infinity
      topLabels[k] = 0
    }

    const selected = Search.selectFine(query)

    for (let i = 0; i < selected; i++) {
      const fine = fineOrder[i]
      const start = fineOffsets[fine]
      const end = fineOffsets[fine + 1]

      if (start === end) {
        continue
      }

      if (Search.bboxLowerBound(query, fine) >= topDistances[CONSTANTS.TOP_K - 1]) {
        continue
      }

      Search.scanFine(query, start, end)
    }

    let fraudCount = 0

    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      fraudCount += topLabels[k]
    }

    return fraudCount
  },
}
