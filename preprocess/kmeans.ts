import { CONSTANTS } from '@Config/constants'

const KMEANS_ITERS = 8
const KMEANS_SAMPLE = 50_000
const N_WORKERS = navigator.hardwareConcurrency || 4

const sampleIndexes = new Uint32Array(KMEANS_SAMPLE)

const workers: Worker[] = []

for (let i = 0; i < N_WORKERS; i++) {
  workers.push(new Worker(new URL('./worker.ts', import.meta.url).href))
}

function toSharedInt16(arr: Int16Array): Int16Array {
  const sab = new SharedArrayBuffer(arr.byteLength)
  const shared = new Int16Array(sab)
  shared.set(arr)
  return shared
}

function toSharedFloat32(arr: Float32Array): Float32Array {
  const sab = new SharedArrayBuffer(arr.byteLength)
  const shared = new Float32Array(sab)
  shared.set(arr)
  return shared
}

function dispatchAssign(
  centroids: Float32Array,
  vectors: Int16Array,
  totalSize: number,
  k: number
) {
  const chunkSize = Math.ceil(totalSize / N_WORKERS)
  const promises: Promise<{ partial: Uint16Array; chunkStart: number }>[] = []

  for (let w = 0; w < N_WORKERS; w++) {
    const start = w * chunkSize
    const end = Math.min(start + chunkSize, totalSize)

    if (start >= end) {
      continue
    }

    const worker = workers[w]

    promises.push(
      new Promise((resolve) => {
        worker.onmessage = (event: MessageEvent<{ assignments: Uint16Array }>) => {
          resolve({ partial: event.data.assignments, chunkStart: start })
        }
        worker.postMessage({
          type: 'assign',
          centroids,
          vectors,
          start,
          end,
          k,
        })
      })
    )
  }

  return Promise.all(promises)
}

function dispatchTrainStep(
  centroids: Float32Array,
  sample: Float32Array,
  sampleSize: number,
  k: number
) {
  const chunkSize = Math.ceil(sampleSize / N_WORKERS)
  const promises: Promise<{ sums: Float64Array; counts: Uint32Array }>[] = []

  for (let w = 0; w < N_WORKERS; w++) {
    const start = w * chunkSize
    const end = Math.min(start + chunkSize, sampleSize)

    if (start >= end) {
      continue
    }

    const worker = workers[w]

    promises.push(
      new Promise((resolve) => {
        worker.onmessage = (
          event: MessageEvent<{ sums: Float64Array; counts: Uint32Array }>
        ) => {
          resolve(event.data)
        }
        worker.postMessage({
          type: 'train',
          centroids,
          sample,
          start,
          end,
          k,
        })
      })
    )
  }

  return Promise.all(promises)
}

export const KMeans = {
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

  async train(vectors: Int16Array) {
    const localSample = KMeans.fillSample(vectors)
    const sample = toSharedFloat32(localSample)
    const sampleSize = sample.length / CONSTANTS.DIMS
    const centroids = toSharedFloat32(KMeans.seed(localSample, sampleSize))

    const sums = new Float64Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)
    const counts = new Uint32Array(CONSTANTS.FINE_COUNT)

    for (let iter = 0; iter < KMEANS_ITERS; iter++) {
      const partials = await dispatchTrainStep(
        centroids,
        sample,
        sampleSize,
        CONSTANTS.FINE_COUNT
      )

      sums.fill(0)
      counts.fill(0)

      for (const partial of partials) {
        for (let i = 0; i < sums.length; i++) {
          sums[i] += partial.sums[i]
        }
        for (let i = 0; i < counts.length; i++) {
          counts[i] += partial.counts[i]
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

  async assign(vectors: Int16Array, centroids: Float32Array) {
    const size = vectors.length / CONSTANTS.DIMS
    const shared = toSharedInt16(vectors)
    const partials = await dispatchAssign(
      centroids,
      shared,
      size,
      CONSTANTS.FINE_COUNT
    )

    const assignments = new Uint16Array(size)

    for (const { partial, chunkStart } of partials) {
      assignments.set(partial, chunkStart)
    }

    return assignments
  },

  terminate() {
    for (const worker of workers) {
      worker.terminate()
    }
  },
}
