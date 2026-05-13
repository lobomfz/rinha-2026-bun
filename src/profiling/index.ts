import { emit, snapshot } from './emit'
import {
  markDrain,
  markFirstByte,
  markRequestComplete,
  markSocketReadable,
  markWriteDone,
  markWriteQueued,
} from './marks'
import {
  add,
  addCounter,
  begin,
  count,
  finish,
  identify,
  runMeasure,
  scanCall,
  set,
  setTraceId,
} from './measure'
import { startEventLoopProbe } from './probes'

export const measure = Object.assign(runMeasure, {
  add,
  addCounter,
  begin,
  count,
  emit,
  finish,
  identify,
  markDrain,
  markFirstByte,
  markRequestComplete,
  markSocketReadable,
  markWriteDone,
  markWriteQueued,
  scanCall,
  set,
  setTraceId,
  snapshot,
  startEventLoopProbe,
})
