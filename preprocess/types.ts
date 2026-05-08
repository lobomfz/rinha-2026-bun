export type Reference = {
  vector: number[]
  label: 'legit' | 'fraud'
}

export type LoadedReferences = {
  refs: Reference[]
  vectors: Int16Array
  labels: Uint8Array
  fraudCount: number
}

export type FineTraining = {
  assignments: Uint16Array
  centroidFloats: Float32Array
  fineCounts: Uint32Array
  fineFraudCounts: Uint32Array
}

export type FineArtifacts = {
  orderedVectors: Int16Array
  fineCentroids: Int16Array
  fineBboxes: Int16Array
  fineOffsets: Uint32Array
  fineFraudEnd: Uint32Array
  fineRadii: Float32Array
  pqSubCentroids: Float32Array
  pqCodes: Uint8Array
}
