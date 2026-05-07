import { vectors, labels } from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'

export const Search = {
  size: labels.length,

  knn(query: Int16Array) {
    const topDistances = new Float64Array(CONSTANTS.TOP_K)
    const topLabels = new Uint8Array(CONSTANTS.TOP_K)

    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      topDistances[k] = Infinity
      topLabels[k] = 0
    }

    let worstTop = Infinity

    for (let i = 0; i < labels.length; i++) {
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
        topDistances[slot] = topDistances[slot - 1]!
        topLabels[slot] = topLabels[slot - 1]!
        slot--
      }

      topDistances[slot] = distance
      topLabels[slot] = labels[i]!
      worstTop = topDistances[CONSTANTS.TOP_K - 1]!
    }

    let fraudCount = 0

    for (let k = 0; k < CONSTANTS.TOP_K; k++) {
      fraudCount += topLabels[k]
    }

    return fraudCount
  },
}
