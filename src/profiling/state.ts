import {
  EVENT_LOOP_SAMPLE_CAPACITY,
  PERF_SAMPLE_CAPACITY,
  SAMPLE_CAPACITY,
  SCAN_CALL_CAPACITY,
  SLOWEST_CAPACITY,
} from './constants'
import { COUNTERS, PHASES } from './schema'
import type { Counter, Phase, SocketTiming, SystemSnapshot } from './schema'

export const samples = {
  phase: {} as Record<Phase, Float64Array>,
  counter: {} as Record<Counter, Float64Array>,
  totalNs: new Float64Array(SAMPLE_CAPACITY),
  socketReadableOffset: new Float64Array(SAMPLE_CAPACITY),
  requestCompleteOffset: new Float64Array(SAMPLE_CAPACITY),
  handlerStartOffset: new Float64Array(SAMPLE_CAPACITY),
  writeQueuedOffset: new Float64Array(SAMPLE_CAPACITY),
  writeDoneOffset: new Float64Array(SAMPLE_CAPACITY),
  writeDrainOffset: new Float64Array(SAMPLE_CAPACITY),
  heapDelta: new Float64Array(SAMPLE_CAPACITY),
  heapGrowth: new Float64Array(SAMPLE_CAPACITY),
  heapCollected: new Float64Array(SAMPLE_CAPACITY),
  heapTotalDelta: new Float64Array(SAMPLE_CAPACITY),
  rssDelta: new Float64Array(SAMPLE_CAPACITY),
  interArrival: new Float64Array(SAMPLE_CAPACITY),
  inFlight: new Float64Array(SAMPLE_CAPACITY),
  activeAtStart: new Float64Array(SAMPLE_CAPACITY),
  scanCall: new Float64Array(SCAN_CALL_CAPACITY),
  eventLoopLag: new Float64Array(EVENT_LOOP_SAMPLE_CAPACITY),
  perfWall: new Float64Array(PERF_SAMPLE_CAPACITY),
  perfCpuUser: new Float64Array(PERF_SAMPLE_CAPACITY),
  perfCpuSystem: new Float64Array(PERF_SAMPLE_CAPACITY),
  perfCpuTotal: new Float64Array(PERF_SAMPLE_CAPACITY),
}

export const counts = {
  sample: 0,
  scanCall: 0,
  eventLoopLag: 0,
  perfSample: 0,
  inFlight: 0,
  activeRequests: 0,
  maxActiveRequests: 0,
}

export const session = {
  startedAt: 0,
  currentId: '',
  currentTraceId: 0,
  heapStart: 0,
  heapTotalStart: 0,
  rssStart: 0,
  lastFinishedAt: 0,
  perfSampled: false,
  perfStartedAt: 0,
  perfUserStartedAt: 0,
  perfSystemStartedAt: 0,
  eventLoopProbeStarted: false,
  expectedEventLoopAt: 0,
}

export const counterSums = {} as Record<Counter, number>

export const slowest: {
  id: string
  traceId: number
  totalNs: number
  row: number
}[] = []

export const eventLoopWorst: number[] = []
export const systemSnapshots: SystemSnapshot[] = []
export const socketTimings = new WeakMap<object, SocketTiming>()

for (const p of PHASES) {
  samples.phase[p] = new Float64Array(SAMPLE_CAPACITY)
}

for (const c of COUNTERS) {
  samples.counter[c] = new Float64Array(SAMPLE_CAPACITY)
  counterSums[c] = 0
}

export function insertWorst(values: number[], value: number) {
  if (values.length < SLOWEST_CAPACITY) {
    values.push(value)
  } else if (value > values[SLOWEST_CAPACITY - 1]) {
    values[SLOWEST_CAPACITY - 1] = value
  } else {
    return
  }

  let i = values.length - 1

  while (i > 0 && values[i - 1] < values[i]) {
    const tmp = values[i - 1]

    values[i - 1] = values[i]
    values[i] = tmp
    i--
  }
}

export function insertSlowest(
  id: string,
  traceId: number,
  totalNs: number,
  row: number
) {
  if (slowest.length < SLOWEST_CAPACITY) {
    slowest.push({ id, traceId, totalNs, row })
  } else if (totalNs > slowest[SLOWEST_CAPACITY - 1].totalNs) {
    slowest[SLOWEST_CAPACITY - 1] = { id, traceId, totalNs, row }
  } else {
    return
  }

  let i = slowest.length - 1

  while (i > 0 && slowest[i - 1].totalNs < slowest[i].totalNs) {
    const tmp = slowest[i - 1]

    slowest[i - 1] = slowest[i]
    slowest[i] = tmp
    i--
  }
}
