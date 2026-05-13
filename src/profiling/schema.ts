export const PHASES = [
  'recvBuffered',
  'parse',
  'vectorize',
  'quantize',
  'search',
  'selectFine',
  'fastSelectFine',
  'fastLb',
  'fastScanSelected',
  'fallbackSelectFine',
  'fallbackLb',
  'fallbackScanSelected',
  'sfLut',
  'sfInit',
  'sfBuild',
  'sfMain',
  'lb',
  'scan',
  'writeOut',
] as const

export const COUNTERS = [
  'requestBytes',
  'selectedBuckets',
  'scannedBuckets',
  'skippedBuckets',
  'scannedVectors',
  'fraudCount',
  'scanExitAtDim4',
  'scanExitAtDim8',
  'scanExitAtDim12',
  'scanExitAtDim14',
  'writeExpectedBytes',
  'writeReturnedBytes',
  'writeShort',
  'fastPath',
  'fallbackPath',
] as const

export const HISTOGRAM_BOUNDS_NS = [
  1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 512_000,
  1_000_000, 2_000_000, 4_000_000, 8_000_000, 10_000_000,
] as const

export type Phase = (typeof PHASES)[number]
export type Counter = (typeof COUNTERS)[number]

export interface CgroupStat {
  nr_periods: number
  nr_throttled: number
  throttled_usec: number
}

export interface SystemSnapshot {
  atNs: number
  load1: number
  load5: number
  load15: number
  rssBytes: number
  voluntaryContextSwitches: number
  nonvoluntaryContextSwitches: number
}

export type SocketTiming = {
  socketReadableAt: number
  requestCompleteAt: number
  drainRow: number
  drainFirstByteAt: number
}
