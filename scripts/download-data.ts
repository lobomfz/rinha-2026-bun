import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const upstream =
  'https://raw.githubusercontent.com/zanfranceschi/rinha-de-backend-2026/main'

const downloads = [
  {
    path: 'data/references.json.gz',
    url: `${upstream}/resources/references.json.gz`,
  },
  {
    path: 'data/test-data.json',
    url: `${upstream}/test/test-data.json`,
  },
]

for (const { path, url } of downloads) {
  const alreadyDownloaded = await stat(path)
    .then((info) => !!info.size)
    .catch(() => false)

  if (alreadyDownloaded) {
    console.log(`ok ${path}`)
    continue
  }

  await mkdir(dirname(path), { recursive: true })

  console.log(`downloading ${path}`)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `failed to download ${url}: ${response.status} ${response.statusText}`
    )
  }

  const buffer = await response.arrayBuffer()

  console.log(`saving ${path}`)

  await Bun.write(`${path}.tmp`, buffer)

  await rename(`${path}.tmp`, path)

  console.log(`downloaded ${path}`)
}
