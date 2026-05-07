import {
  labels,
  regionCentroids,
  regionOffsets,
  vectors,
} from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'

const regionLimit = Math.min(CONSTANTS.REGION_PROBE, CONSTANTS.REGION_COUNT)
const regionDistances = new Float64Array(regionLimit)
const regionOrder = new Uint16Array(regionLimit)
const topDistances = new Float64Array(CONSTANTS.TOP_K)
const topLabels = new Uint8Array(CONSTANTS.TOP_K)

export const Search = {
  size: labels.length,

  insertSelectedRegion(distance: number, region: number, slot: number) {
    while (slot > 0 && regionDistances[slot - 1] > distance) {
      regionDistances[slot] = regionDistances[slot - 1]
      regionOrder[slot] = regionOrder[slot - 1]
      slot--
    }

    regionDistances[slot] = distance
    regionOrder[slot] = region
  },

  selectRegions(query: Int16Array) {
    let selected = 0

    for (let region = 0; region < CONSTANTS.REGION_COUNT; region++) {
      const offset = region * CONSTANTS.DIMS
      let distance = 0

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        const diff = query[dim] - regionCentroids[offset + dim]

        distance += diff * diff
      }

      if (selected < regionLimit) {
        const slot = selected
        selected++
        Search.insertSelectedRegion(distance, region, slot)
        continue
      }

      if (distance >= regionDistances[regionLimit - 1]) {
        continue
      }

      Search.insertSelectedRegion(distance, region, regionLimit - 1)
    }

    return selected
  },

  scanRegion(query: Int16Array, start: number, end: number) {
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

    const selected = Search.selectRegions(query)

    for (let i = 0; i < selected; i++) {
      const region = regionOrder[i]
      const start = regionOffsets[region]
      const end = regionOffsets[region + 1]

      if (start === end) {
        continue
      }

      Search.scanRegion(query, start, end)
    }

    let fraudCount = 0

    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      fraudCount += topLabels[k]
    }

    return fraudCount
  },
}
