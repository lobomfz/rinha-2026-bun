import { SAMPLE_CAPACITY } from './constants'
import type { SocketTiming } from './schema'
import { counts, samples, socketTimings } from './state'

function socketTiming(state: object): SocketTiming {
  let timing = socketTimings.get(state)

  if (!timing) {
    timing = {
      socketReadableAt: 0,
      requestCompleteAt: 0,
      drainRow: -1,
      drainFirstByteAt: 0,
    }
    socketTimings.set(state, timing)
  }

  return timing
}

export function markFirstByte(state: { firstByteAt: number }) {
  state.firstByteAt = Bun.nanoseconds()
}

export function markSocketReadable(state: object) {
  socketTiming(state).socketReadableAt = Bun.nanoseconds()
}

export function markRequestComplete(state: object) {
  socketTiming(state).requestCompleteAt = Bun.nanoseconds()
}

export function markWriteQueued(state: { firstByteAt: number }) {
  if (counts.sample >= SAMPLE_CAPACITY || state.firstByteAt <= 0) {
    return
  }

  samples.writeQueuedOffset[counts.sample] = Bun.nanoseconds() - state.firstByteAt
}

export function markWriteDone(
  state: { firstByteAt: number },
  expectedBytes: number,
  returnedBytes: number
) {
  if (counts.sample >= SAMPLE_CAPACITY || state.firstByteAt <= 0) {
    return
  }

  const now = Bun.nanoseconds()
  const writeQueuedOffset = samples.writeQueuedOffset[counts.sample]

  samples.counter.writeExpectedBytes[counts.sample] = expectedBytes
  samples.counter.writeReturnedBytes[counts.sample] = returnedBytes

  if (returnedBytes < expectedBytes) {
    samples.counter.writeShort[counts.sample] = 1

    const timing = socketTiming(state)
    timing.drainRow = counts.sample
    timing.drainFirstByteAt = state.firstByteAt
  }

  samples.writeDoneOffset[counts.sample] = now - state.firstByteAt

  if (writeQueuedOffset > 0) {
    samples.phase.writeOut[counts.sample] +=
      samples.writeDoneOffset[counts.sample] - writeQueuedOffset
  }
}

export function markDrain(state: object) {
  const timing = socketTimings.get(state)

  if (!timing || timing.drainRow < 0 || timing.drainFirstByteAt <= 0) {
    return
  }

  samples.writeDrainOffset[timing.drainRow] =
    Bun.nanoseconds() - timing.drainFirstByteAt
  timing.drainRow = -1
  timing.drainFirstByteAt = 0
}
