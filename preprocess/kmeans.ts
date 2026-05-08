import { CONSTANTS } from '@Config/constants'

const KMEANS_ITERS = 8
const KMEANS_SAMPLE = 50_000

const sampleIndexes = new Uint32Array(KMEANS_SAMPLE)

export const KMeans = {
  distance(
    vectors: Int16Array | Float32Array,
    vectorOffset: number,
    centroids: Float32Array,
    centroidOffset: number
  ) {
    let distance = 0

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      const diff = vectors[vectorOffset + dim] - centroids[centroidOffset + dim]

      distance += diff * diff
    }

    return distance
  },

  fillSample(vectors: Int16Array) {
    const size = vectors.length / CONSTANTS.DIMS
    const sampleSize = Math.min(KMEANS_SAMPLE, size)
    const sample = new Float32Array(sampleSize * CONSTANTS.DIMS)

    let cursor = 0x9e3779b9

    for (let i = 0; i < sampleSize; i++) {
      cursor = Math.imul(cursor, 1664525) + 1013904223

      const index = Math.abs(cursor) % size
      const src = index * CONSTANTS.DIMS
      const dst = i * CONSTANTS.DIMS

      sampleIndexes[i] = index

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        sample[dst + dim] = vectors[src + dim]
      }
    }

    return sample
  },

  seed(sample: Float32Array, count: number) {
    const centroids = new Float32Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)
    const step = count / CONSTANTS.FINE_COUNT

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const src = Math.floor((fine + 0.5) * step) * CONSTANTS.DIMS
      const dst = fine * CONSTANTS.DIMS

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        centroids[dst + dim] = sample[src + dim]
      }
    }

    return centroids
  },

  train(vectors: Int16Array) {
    const sample = KMeans.fillSample(vectors)
    const sampleSize = sample.length / CONSTANTS.DIMS
    const centroids = KMeans.seed(sample, sampleSize)

    const sums = new Float64Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)
    const counts = new Uint32Array(CONSTANTS.FINE_COUNT)

    for (let iter = 0; iter < KMEANS_ITERS; iter++) {
      sums.fill(0)
      counts.fill(0)

      for (let i = 0; i < sampleSize; i++) {
        const src = i * CONSTANTS.DIMS
        const fine = KMeans.nearest(sample, src, centroids)
        const dst = fine * CONSTANTS.DIMS

        counts[fine]++

        for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
          sums[dst + dim] += sample[src + dim]
        }
      }

      for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
        const count = counts[fine]
        const offset = fine * CONSTANTS.DIMS

        if (count === 0) {
          const src = sampleIndexes[fine % sampleSize] * CONSTANTS.DIMS

          for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
            centroids[offset + dim] = vectors[src + dim]
          }

          continue
        }

        for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
          centroids[offset + dim] = sums[offset + dim] / count
        }
      }
    }

    return centroids
  },

  nearest(
    vectors: Int16Array | Float32Array,
    offset: number,
    centroids: Float32Array
  ) {
    let best = 0
    let bestDistance = Infinity

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const centroidOffset = fine * CONSTANTS.DIMS
      let distance = 0

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        const diff = vectors[offset + dim] - centroids[centroidOffset + dim]

        distance += diff * diff

        if (distance >= bestDistance) {
          break
        }
      }

      if (distance < bestDistance) {
        bestDistance = distance
        best = fine
      }
    }

    return best
  },

  assign(vectors: Int16Array, centroids: Float32Array) {
    const size = vectors.length / CONSTANTS.DIMS
    const assignments = new Uint16Array(size)

    for (let i = 0; i < size; i++) {
      assignments[i] = KMeans.nearest(vectors, i * CONSTANTS.DIMS, centroids)
    }

    return assignments
  },
}
