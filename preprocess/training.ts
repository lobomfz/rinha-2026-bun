import { CONSTANTS } from '@Config/constants'
import { KMeans } from './kmeans'
import type { FineTraining } from './types'

export const PreprocessTraining = {
  async fine(vectors: Int16Array, labels: Uint8Array): Promise<FineTraining> {
    const fineCounts = new Uint32Array(CONSTANTS.FINE_COUNT)
    const fineFraudCounts = new Uint32Array(CONSTANTS.FINE_COUNT)
    const centroidSums = new Float64Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)

    const centroidFloats = await KMeans.train(vectors)
    const assignments = await KMeans.assign(vectors, centroidFloats)

    for (let i = 0; i < assignments.length; i++) {
      const fine = assignments[i]
      const src = i * CONSTANTS.DIMS
      const dst = fine * CONSTANTS.DIMS

      fineCounts[fine]++

      if (labels[i] === 1) {
        fineFraudCounts[fine]++
      }

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        centroidSums[dst + dim] += vectors[src + dim]
      }
    }

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const count = fineCounts[fine]
      const offset = fine * CONSTANTS.DIMS

      if (count === 0) {
        continue
      }

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        centroidFloats[offset + dim] = centroidSums[offset + dim] / count
      }
    }

    return { assignments, centroidFloats, fineCounts, fineFraudCounts }
  },
}
