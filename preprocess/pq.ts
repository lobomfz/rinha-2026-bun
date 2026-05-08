import { CONSTANTS } from '@Config/constants'

export const PreprocessPq = {
  kmeansSubspace(
    points: Float32Array,
    n: number,
    k: number,
    subDim: number,
    iters: number
  ) {
    const centroids = new Float32Array(k * subDim)
    const assignments = new Uint8Array(n)
    const sums = new Float64Array(k * subDim)
    const counts = new Uint32Array(k)

    for (let c = 0; c < k; c++) {
      const src = Math.floor(((c + 0.5) * n) / k) * subDim
      const dst = c * subDim

      for (let d = 0; d < subDim; d++) {
        centroids[dst + d] = points[src + d]
      }
    }

    for (let iter = 0; iter < iters; iter++) {
      for (let i = 0; i < n; i++) {
        const pBase = i * subDim
        let bestC = 0
        let bestDist = Infinity

        for (let c = 0; c < k; c++) {
          const cBase = c * subDim
          let dist = 0

          for (let d = 0; d < subDim; d++) {
            const diff = points[pBase + d] - centroids[cBase + d]

            dist += diff * diff
          }

          if (dist < bestDist) {
            bestDist = dist
            bestC = c
          }
        }

        assignments[i] = bestC
      }

      sums.fill(0)
      counts.fill(0)

      for (let i = 0; i < n; i++) {
        const c = assignments[i]
        const pBase = i * subDim
        const sBase = c * subDim

        counts[c]++
        for (let d = 0; d < subDim; d++) {
          sums[sBase + d] += points[pBase + d]
        }
      }

      let cursor = 0x9e3779b9

      for (let c = 0; c < k; c++) {
        const cBase = c * subDim

        if (counts[c] === 0) {
          cursor = Math.imul(cursor, 1664525) + 1013904223

          const src = (Math.abs(cursor) % n) * subDim

          for (let d = 0; d < subDim; d++) {
            centroids[cBase + d] = points[src + d]
          }

          continue
        }

        const inv = 1 / counts[c]

        for (let d = 0; d < subDim; d++) {
          centroids[cBase + d] = sums[cBase + d] * inv
        }
      }
    }

    return { centroids, assignments }
  },

  train(fineCentroids: Int16Array) {
    const { FINE_COUNT, PQ_M, PQ_K, PQ_SUB_DIM, PQ_ITERS, DIMS } = CONSTANTS

    const subCentroids = new Float32Array(PQ_M * PQ_K * PQ_SUB_DIM)
    const codes = new Uint8Array(FINE_COUNT * PQ_M)
    const sub = new Float32Array(FINE_COUNT * PQ_SUB_DIM)

    for (let s = 0; s < PQ_M; s++) {
      for (let fine = 0; fine < FINE_COUNT; fine++) {
        for (let d = 0; d < PQ_SUB_DIM; d++) {
          const dim = s * PQ_SUB_DIM + d

          sub[fine * PQ_SUB_DIM + d] = fineCentroids[dim * FINE_COUNT + fine]
        }
      }

      const result = this.kmeansSubspace(
        sub,
        FINE_COUNT,
        PQ_K,
        PQ_SUB_DIM,
        PQ_ITERS
      )

      const subBase = s * PQ_K * PQ_SUB_DIM

      subCentroids.set(result.centroids, subBase)

      for (let fine = 0; fine < FINE_COUNT; fine++) {
        codes[fine * PQ_M + s] = result.assignments[fine]
      }
    }

    if (PQ_M * PQ_SUB_DIM !== DIMS) {
      throw new Error(
        `PQ_M * PQ_SUB_DIM (${PQ_M * PQ_SUB_DIM}) must equal DIMS (${DIMS})`
      )
    }

    return { subCentroids, codes }
  },
}
