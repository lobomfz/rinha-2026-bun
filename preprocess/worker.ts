import { CONSTANTS } from '@Config/constants'

declare const self: Worker

type AssignTask = {
  type: 'assign'
  centroids: Float32Array
  vectors: Int16Array
  start: number
  end: number
  k: number
}

type TrainTask = {
  type: 'train'
  centroids: Float32Array
  sample: Float32Array
  start: number
  end: number
  k: number
}

function nearest(
  vectors: Int16Array | Float32Array,
  offset: number,
  centroids: Float32Array,
  k: number
) {
  let best = 0
  let bestDistance = Infinity

  for (let fine = 0; fine < k; fine++) {
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
}

self.onmessage = (event: MessageEvent<AssignTask | TrainTask>) => {
  const task = event.data

  if (task.type === 'assign') {
    const length = task.end - task.start
    const assignments = new Uint16Array(length)

    for (let i = 0; i < length; i++) {
      const offset = (task.start + i) * CONSTANTS.DIMS
      assignments[i] = nearest(task.vectors, offset, task.centroids, task.k)
    }

    self.postMessage({ assignments }, { transfer: [assignments.buffer] })
    return
  }

  const sums = new Float64Array(task.k * CONSTANTS.DIMS)
  const counts = new Uint32Array(task.k)

  for (let i = task.start; i < task.end; i++) {
    const offset = i * CONSTANTS.DIMS
    const fine = nearest(task.sample, offset, task.centroids, task.k)
    const dst = fine * CONSTANTS.DIMS

    counts[fine]++

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      sums[dst + dim] += task.sample[offset + dim]
    }
  }

  self.postMessage({ sums, counts }, { transfer: [sums.buffer, counts.buffer] })
}
