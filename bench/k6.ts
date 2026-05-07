import { mkdir, rename } from 'node:fs/promises'

type K6Run = {
  name: string
  script: string
  resultsDir: string
}

export const K6 = {
  async run({ name, script, resultsDir }: K6Run) {
    await mkdir(resultsDir, { recursive: true })

    const datetime = new Date()
      .toISOString()
      .replaceAll(':', '-')
      .replaceAll('.', '-')

    const latestPath = `${resultsDir}/${name}-latest.json`
    const resultPath = `${resultsDir}/${name}-${datetime}.json`

    console.log(`k6 running ${script}`)

    const k6 = await Bun.spawn(
      ['k6', 'run', '--quiet', '--summary-export', latestPath, script],
      {
        stdout: 'ignore',
        stderr: 'ignore',
      }
    ).exited

    const wroteSummary = await Bun.file(latestPath).exists()

    if (!wroteSummary) {
      process.exit(k6)
    }

    await rename(latestPath, resultPath)

    console.log(`summary saved ${resultPath}`)

    return { exitCode: k6, resultPath }
  },
}
