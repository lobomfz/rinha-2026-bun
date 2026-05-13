import {
  PERF_SAMPLE_CAPACITY,
  PERF_SAMPLE_RATE,
  SAMPLE_CAPACITY,
  SCAN_CALL_CAPACITY,
  TRACE_ID,
} from './constants'
import { COUNTERS, PHASES } from './schema'
import type { Counter, Phase } from './schema'
import {
  counterSums,
  counts,
  insertSlowest,
  samples,
  session,
  socketTimings,
} from './state'

export function add(name: Phase, elapsedNs: number) {
  if (counts.sample >= SAMPLE_CAPACITY) {
    return
  }

  samples.phase[name][counts.sample] += elapsedNs
}

export function set(name: Counter, value: number) {
  if (counts.sample >= SAMPLE_CAPACITY) {
    return
  }

  samples.counter[name][counts.sample] = value
}

export function addCounter(name: Counter, value: number) {
  if (counts.sample >= SAMPLE_CAPACITY) {
    return
  }

  samples.counter[name][counts.sample] += value
}

export function count(name: Counter, value = 1) {
  addCounter(name, value)
}

export function runMeasure(
  name: Phase,
  fn: () => number,
  resultName: Counter
): number
export function runMeasure<T>(name: Phase, fn: () => T): T
export function runMeasure<T>(
  name: Phase,
  fn: () => T,
  resultName?: Counter
) {
  const start = Bun.nanoseconds()
  const result = fn()

  add(name, Bun.nanoseconds() - start)

  if (resultName) {
    if (typeof result !== 'number') {
      throw new TypeError('measured result must be a number to be saved')
    }

    set(resultName, result)
  }

  return result
}

export function begin(id: string, firstByteAt = 0, state?: object) {
  counts.inFlight++
  counts.activeRequests++
  counts.maxActiveRequests = Math.max(
    counts.maxActiveRequests,
    counts.activeRequests
  )
  session.currentId = id
  const now = Bun.nanoseconds()
  const socketTiming = state ? socketTimings.get(state) : undefined

  if (counts.sample >= SAMPLE_CAPACITY) {
    session.startedAt = now
    return
  }

  samples.interArrival[counts.sample] =
    session.lastFinishedAt > 0 ? now - session.lastFinishedAt : 0
  const memory = process.memoryUsage()

  session.heapStart = memory.heapUsed
  session.heapTotalStart = memory.heapTotal
  session.rssStart = memory.rss
  samples.inFlight[counts.sample] = counts.inFlight
  samples.activeAtStart[counts.sample] = counts.activeRequests
  session.startedAt = now
  session.perfSampled =
    counts.perfSample < PERF_SAMPLE_CAPACITY &&
    counts.sample % PERF_SAMPLE_RATE === 0

  if (session.perfSampled) {
    const cpu = process.cpuUsage()

    session.perfStartedAt = now
    session.perfUserStartedAt = cpu.user
    session.perfSystemStartedAt = cpu.system
  }

  for (const p of PHASES) {
    samples.phase[p][counts.sample] = 0
  }

  if (firstByteAt > 0) {
    samples.phase.recvBuffered[counts.sample] = now - firstByteAt
    samples.handlerStartOffset[counts.sample] = now - firstByteAt
  }

  if (socketTiming && socketTiming.socketReadableAt > 0 && firstByteAt > 0) {
    samples.socketReadableOffset[counts.sample] =
      socketTiming.socketReadableAt - firstByteAt
  }

  if (socketTiming && socketTiming.requestCompleteAt > 0 && firstByteAt > 0) {
    samples.requestCompleteOffset[counts.sample] =
      socketTiming.requestCompleteAt - firstByteAt
  }

  for (const c of COUNTERS) {
    samples.counter[c][counts.sample] = 0
  }
}

export function identify(id: string) {
  session.currentId = id
}

export function setTraceId(buffer: Buffer, end: number) {
  const index = buffer.indexOf(TRACE_ID)

  if (index < 0 || index >= end) {
    session.currentTraceId = 0
    return
  }

  let cursor = index + TRACE_ID.length

  while (cursor < end && (buffer[cursor] === 0x20 || buffer[cursor] === 0x09)) {
    cursor++
  }

  let traceId = 0

  while (cursor < end) {
    const code = buffer[cursor]

    if (code < 0x30 || code > 0x39) {
      break
    }

    traceId = traceId * 10 + code - 0x30
    cursor++
  }

  session.currentTraceId = traceId
}

export function finish() {
  if (counts.sample >= SAMPLE_CAPACITY) {
    counts.inFlight = Math.max(0, counts.inFlight - 1)
    counts.activeRequests = Math.max(0, counts.activeRequests - 1)
    return
  }

  const now = Bun.nanoseconds()
  const totalNs = now - session.startedAt
  const memory = process.memoryUsage()
  const heapDelta = memory.heapUsed - session.heapStart

  samples.totalNs[counts.sample] = totalNs
  samples.heapDelta[counts.sample] = heapDelta
  samples.heapGrowth[counts.sample] = heapDelta > 0 ? heapDelta : 0
  samples.heapCollected[counts.sample] = heapDelta < 0 ? -heapDelta : 0
  samples.heapTotalDelta[counts.sample] = memory.heapTotal - session.heapTotalStart
  samples.rssDelta[counts.sample] = memory.rss - session.rssStart
  session.lastFinishedAt = now

  if (session.perfSampled && counts.perfSample < PERF_SAMPLE_CAPACITY) {
    const cpu = process.cpuUsage()
    const user = cpu.user - session.perfUserStartedAt
    const system = cpu.system - session.perfSystemStartedAt

    samples.perfWall[counts.perfSample] = now - session.perfStartedAt
    samples.perfCpuUser[counts.perfSample] = user
    samples.perfCpuSystem[counts.perfSample] = system
    samples.perfCpuTotal[counts.perfSample] = user + system
    counts.perfSample++
  }

  for (const c of COUNTERS) {
    counterSums[c] += samples.counter[c][counts.sample]
  }

  insertSlowest(session.currentId, session.currentTraceId, totalNs, counts.sample)
  session.currentTraceId = 0
  counts.sample++
  counts.inFlight = Math.max(0, counts.inFlight - 1)
  counts.activeRequests = Math.max(0, counts.activeRequests - 1)
}

export function scanCall(elapsedNs: number) {
  if (counts.scanCall >= SCAN_CALL_CAPACITY) {
    return
  }

  samples.scanCall[counts.scanCall] = elapsedNs
  counts.scanCall++
}
