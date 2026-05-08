import { fineCentroids } from '@Config/artifacts'
import { CONSTANTS } from '@Config/constants'
import { bench, run } from 'mitata'
import fixtures from '../../data/test-data.json'
import { Scoring } from '../../src/scoring'
import type { Payload } from '../../src/types'
import { Vectorize } from '../../src/vectorize'

type Entry = { request: Payload }
type Fixtures = { entries: Entry[] }

const FINE_LIMIT = Math.min(CONSTANTS.FINE_PROBE, CONSTANTS.FINE_COUNT)

const fineCentroidsSoa = new Int16Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)

for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    fineCentroidsSoa[dim * CONSTANTS.FINE_COUNT + fine] =
      fineCentroids[fine * CONSTANTS.DIMS + dim]
  }
}

const queries: Int16Array[] = []

{
  const v = new Float32Array(CONSTANTS.DIMS)
  const sample = Math.min(64, (fixtures as Fixtures).entries.length)

  for (let i = 0; i < sample; i++) {
    const q = new Int16Array(CONSTANTS.DIMS)

    Vectorize.transform((fixtures as Fixtures).entries[i].request, v)
    Scoring.quantize(v, q)
    queries.push(q)
  }
}

const aDists = new Float64Array(FINE_LIMIT)
const aOrder = new Uint16Array(FINE_LIMIT)

function aosInlineInsert(dist: number, fine: number, slot: number) {
  while (slot > 0 && aDists[slot - 1] > dist) {
    aDists[slot] = aDists[slot - 1]
    aOrder[slot] = aOrder[slot - 1]
    slot--
  }

  aDists[slot] = dist
  aOrder[slot] = fine
}

function selectFineAosInline(query: Int16Array): number {
  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const offset = fine * CONSTANTS.DIMS
    let distance = 0

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      const diff = query[dim] - fineCentroids[offset + dim]

      distance += diff * diff
    }

    if (selected < FINE_LIMIT) {
      aosInlineInsert(distance, fine, selected)
      selected++
      continue
    }

    if (distance >= aDists[FINE_LIMIT - 1]) {
      continue
    }

    aosInlineInsert(distance, fine, FINE_LIMIT - 1)
  }

  return selected
}

const bAll = new Float64Array(CONSTANTS.FINE_COUNT)
const bDists = new Float64Array(FINE_LIMIT)
const bOrder = new Uint16Array(FINE_LIMIT)

function aosTwoPassInsert(dist: number, fine: number, slot: number) {
  while (slot > 0 && bDists[slot - 1] > dist) {
    bDists[slot] = bDists[slot - 1]
    bOrder[slot] = bOrder[slot - 1]
    slot--
  }

  bDists[slot] = dist
  bOrder[slot] = fine
}

function selectFineAosTwoPass(query: Int16Array): number {
  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const offset = fine * CONSTANTS.DIMS
    let distance = 0

    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      const diff = query[dim] - fineCentroids[offset + dim]

      distance += diff * diff
    }

    bAll[fine] = distance
  }

  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const distance = bAll[fine]

    if (selected < FINE_LIMIT) {
      aosTwoPassInsert(distance, fine, selected)
      selected++
      continue
    }

    if (distance >= bDists[FINE_LIMIT - 1]) {
      continue
    }

    aosTwoPassInsert(distance, fine, FINE_LIMIT - 1)
  }

  return selected
}

const cAll = new Float64Array(CONSTANTS.FINE_COUNT)
const cDists = new Float64Array(FINE_LIMIT)
const cOrder = new Uint16Array(FINE_LIMIT)

function soaInsert(dist: number, fine: number, slot: number) {
  while (slot > 0 && cDists[slot - 1] > dist) {
    cDists[slot] = cDists[slot - 1]
    cOrder[slot] = cOrder[slot - 1]
    slot--
  }

  cDists[slot] = dist
  cOrder[slot] = fine
}

function selectFineSoa(query: Int16Array): number {
  cAll.fill(0)

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    const qd = query[dim]
    const dimBase = dim * CONSTANTS.FINE_COUNT

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const diff = qd - fineCentroidsSoa[dimBase + fine]

      cAll[fine] += diff * diff
    }
  }

  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const distance = cAll[fine]

    if (selected < FINE_LIMIT) {
      soaInsert(distance, fine, selected)
      selected++
      continue
    }

    if (distance >= cDists[FINE_LIMIT - 1]) {
      continue
    }

    soaInsert(distance, fine, FINE_LIMIT - 1)
  }

  return selected
}

const dAll = new Float64Array(CONSTANTS.FINE_COUNT)
const dDists = new Float64Array(FINE_LIMIT)
const dOrder = new Uint16Array(FINE_LIMIT)

function soaImulInsert(dist: number, fine: number, slot: number) {
  while (slot > 0 && dDists[slot - 1] > dist) {
    dDists[slot] = dDists[slot - 1]
    dOrder[slot] = dOrder[slot - 1]
    slot--
  }

  dDists[slot] = dist
  dOrder[slot] = fine
}

function selectFineSoaImul(query: Int16Array): number {
  dAll.fill(0)

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    const qd = query[dim]
    const dimBase = dim * CONSTANTS.FINE_COUNT

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const diff = qd - fineCentroidsSoa[dimBase + fine]

      dAll[fine] += Math.imul(diff, diff)
    }
  }

  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const distance = dAll[fine]

    if (selected < FINE_LIMIT) {
      soaImulInsert(distance, fine, selected)
      selected++
      continue
    }

    if (distance >= dDists[FINE_LIMIT - 1]) {
      continue
    }

    soaImulInsert(distance, fine, FINE_LIMIT - 1)
  }

  return selected
}

const eAll = new Float32Array(CONSTANTS.FINE_COUNT)
const eDists = new Float32Array(FINE_LIMIT)
const eOrder = new Uint16Array(FINE_LIMIT)

function soaF32Insert(dist: number, fine: number, slot: number) {
  while (slot > 0 && eDists[slot - 1] > dist) {
    eDists[slot] = eDists[slot - 1]
    eOrder[slot] = eOrder[slot - 1]
    slot--
  }

  eDists[slot] = dist
  eOrder[slot] = fine
}

function selectFineSoaF32(query: Int16Array): number {
  eAll.fill(0)

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    const qd = query[dim]
    const dimBase = dim * CONSTANTS.FINE_COUNT

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const diff = qd - fineCentroidsSoa[dimBase + fine]

      eAll[fine] += diff * diff
    }
  }

  let selected = 0

  for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
    const distance = eAll[fine]

    if (selected < FINE_LIMIT) {
      soaF32Insert(distance, fine, selected)
      selected++
      continue
    }

    if (distance >= eDists[FINE_LIMIT - 1]) {
      continue
    }

    soaF32Insert(distance, fine, FINE_LIMIT - 1)
  }

  return selected
}

function verify() {
  const q = queries[0]

  const aSel = selectFineAosInline(q)
  const aTop = Array.from(aDists.subarray(0, aSel))

  const bSel = selectFineAosTwoPass(q)
  const bTop = Array.from(bDists.subarray(0, bSel))

  const cSel = selectFineSoa(q)
  const cTop = Array.from(cDists.subarray(0, cSel))

  const dSel = selectFineSoaImul(q)
  const dTop = Array.from(dDists.subarray(0, dSel))

  const eSel = selectFineSoaF32(q)

  if (aSel !== bSel || aSel !== cSel || aSel !== dSel || aSel !== eSel) {
    throw new Error(
      `selected mismatch: aos=${aSel} aosTp=${bSel} soa=${cSel} soaImul=${dSel} soaF32=${eSel}`
    )
  }

  for (let i = 0; i < aSel; i++) {
    if (aTop[i] !== bTop[i] || aTop[i] !== cTop[i] || aTop[i] !== dTop[i]) {
      throw new Error(
        `top[${i}] aos=${aTop[i]} aosTp=${bTop[i]} soa=${cTop[i]} soaImul=${dTop[i]}`
      )
    }
  }

  const f64Set = new Set(Array.from(cOrder.subarray(0, cSel)))
  let f32Overlap = 0

  for (let i = 0; i < eSel; i++) {
    if (f64Set.has(eOrder[i])) {
      f32Overlap++
    }
  }

  console.log(
    `verified: FINE_COUNT=${CONSTANTS.FINE_COUNT}, FINE_PROBE=${FINE_LIMIT}, ` +
      `selected=${aSel}, top0=${aTop[0]}, topLast=${aTop[aSel - 1]}, ` +
      `f32Overlap=${f32Overlap}/${eSel}`
  )
}

verify()

let qi = 0

bench('aos.inline (current)', () => {
  const q = queries[qi]

  qi = (qi + 1) % queries.length

  return selectFineAosInline(q)
})

bench('aos.twopass', () => {
  const q = queries[qi]

  qi = (qi + 1) % queries.length

  return selectFineAosTwoPass(q)
})

bench('soa.twopass', () => {
  const q = queries[qi]

  qi = (qi + 1) % queries.length

  return selectFineSoa(q)
})

bench('soa.twopass.imul', () => {
  const q = queries[qi]

  qi = (qi + 1) % queries.length

  return selectFineSoaImul(q)
})

bench('soa.twopass.f32', () => {
  const q = queries[qi]

  qi = (qi + 1) % queries.length

  return selectFineSoaF32(q)
})

await run()
