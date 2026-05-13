import { readFileSync } from 'node:fs'
import {
  EVENT_LOOP_INTERVAL_MS,
  EVENT_LOOP_INTERVAL_NS,
  EVENT_LOOP_SAMPLE_CAPACITY,
  SYSTEM_SNAPSHOT_CAPACITY,
  SYSTEM_SNAPSHOT_INTERVAL_MS,
} from './constants'
import type { CgroupStat, SystemSnapshot } from './schema'
import {
  counts,
  eventLoopWorst,
  insertWorst,
  samples,
  session,
  systemSnapshots,
} from './state'

function readCgroup(): CgroupStat | null {
  try {
    const text = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf-8')
    const stat: CgroupStat = {
      nr_periods: 0,
      nr_throttled: 0,
      throttled_usec: 0,
    }

    for (const line of text.split('\n')) {
      const space = line.indexOf(' ')

      if (space < 0) {
        continue
      }

      const name = line.slice(0, space)
      const value = Number(line.slice(space + 1))

      if (name === 'nr_periods') {
        stat.nr_periods = value
        continue
      }

      if (name === 'nr_throttled') {
        stat.nr_throttled = value
        continue
      }

      if (name === 'throttled_usec') {
        stat.throttled_usec = value
      }
    }

    return stat
  } catch {
    return null
  }
}

const cgroupBaseline = readCgroup()

export function cgroupDelta() {
  if (!cgroupBaseline) {
    return null
  }

  const now = readCgroup()

  if (!now) {
    return null
  }

  const periods = now.nr_periods - cgroupBaseline.nr_periods
  const throttled = now.nr_throttled - cgroupBaseline.nr_throttled

  return {
    nr_periods: periods,
    nr_throttled: throttled,
    throttled_usec: now.throttled_usec - cgroupBaseline.throttled_usec,
    throttled_ratio:
      periods > 0 ? Math.round((throttled / periods) * 10000) / 10000 : 0,
  }
}

function readSystemSnapshot(): SystemSnapshot | null {
  try {
    const loadParts = readFileSync('/proc/loadavg', 'utf-8').trim().split(/\s+/)

    const status = readFileSync('/proc/self/status', 'utf-8')
    let rssBytes = process.memoryUsage().rss
    let voluntaryContextSwitches = 0
    let nonvoluntaryContextSwitches = 0

    for (const line of status.split('\n')) {
      const separator = line.indexOf(':')

      if (separator < 0) {
        continue
      }

      const name = line.slice(0, separator)
      const value = line.slice(separator + 1).trim()

      if (name === 'VmRSS') {
        rssBytes = Number(value.split(/\s+/)[0]) * 1024
        continue
      }

      if (name === 'voluntary_ctxt_switches') {
        voluntaryContextSwitches = Number(value)
        continue
      }

      if (name === 'nonvoluntary_ctxt_switches') {
        nonvoluntaryContextSwitches = Number(value)
      }
    }

    return {
      atNs: Bun.nanoseconds(),
      load1: Number(loadParts[0] ?? 0),
      load5: Number(loadParts[1] ?? 0),
      load15: Number(loadParts[2] ?? 0),
      rssBytes,
      voluntaryContextSwitches,
      nonvoluntaryContextSwitches,
    }
  } catch {
    return null
  }
}

export function recordSystemSnapshot() {
  const snapshot = readSystemSnapshot()

  if (!snapshot) {
    return
  }

  if (systemSnapshots.length >= SYSTEM_SNAPSHOT_CAPACITY) {
    systemSnapshots.shift()
  }

  systemSnapshots.push(snapshot)
}

function recordEventLoopLag() {
  const now = Bun.nanoseconds()
  const lag = Math.max(0, now - session.expectedEventLoopAt)

  if (counts.eventLoopLag < EVENT_LOOP_SAMPLE_CAPACITY) {
    samples.eventLoopLag[counts.eventLoopLag] = lag
    counts.eventLoopLag++
  }

  insertWorst(eventLoopWorst, lag)
  session.expectedEventLoopAt = now + EVENT_LOOP_INTERVAL_NS
}

export function startEventLoopProbe() {
  if (session.eventLoopProbeStarted) {
    return
  }

  session.eventLoopProbeStarted = true
  counts.eventLoopLag = 0
  eventLoopWorst.length = 0
  session.expectedEventLoopAt = Bun.nanoseconds() + EVENT_LOOP_INTERVAL_NS

  setInterval(recordEventLoopLag, EVENT_LOOP_INTERVAL_MS).unref()
}

recordSystemSnapshot()
setInterval(recordSystemSnapshot, SYSTEM_SNAPSHOT_INTERVAL_MS).unref()
