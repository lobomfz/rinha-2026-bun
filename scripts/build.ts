import type { BunPlugin } from 'bun'
import { mkdir } from 'node:fs/promises'

const measureConst =
  /^(\s*)const\s+([A-Za-z]\w*)\s*=\s*measure\(\s*(['"])([A-Za-z]\w*)\3\s*,\s*\(\)\s*=>\s*([A-Za-z]\w*(?:\.[A-Za-z]\w*)*\([^()]*\))\s*(?:,\s*(['"])([A-Za-z]\w*)\6)?\s*\)$/gm
const measureAwaitConst =
  /^(\s*)const\s+([A-Za-z]\w*)\s*=\s*\(?await\s+measure\(\s*(['"])([A-Za-z]\w*)\3\s*,\s*\(\)\s*=>\s*([A-Za-z]\w*(?:\.[A-Za-z]\w*)*\([^()]*\))\s*(?:,\s*(['"])([A-Za-z]\w*)\6)?\s*\)\)?(?:\s+as\s+([A-Za-z]\w*))?$/gm
const measureStatement =
  /^(\s*)(return )?measure\(\s*(['"])([A-Za-z]\w*)\3\s*,\s*\(\)\s*=>\s*([A-Za-z]\w*(?:\.[A-Za-z]\w*)*\([^()]*\))\s*(?:,\s*(['"])([A-Za-z]\w*)\6)?\s*\)$/gm
const measureCount =
  /^(\s*)measure\.count\(\s*(['"])([A-Za-z]\w*)\2(?:\s*,\s*([^\n)]+))?\s*\)$/gm
const measureControl =
  /^\s*measure\.(?:begin|finish|set|add|addCounter|identify)\([^\n]*\)\n?/gm
const measureImport = /^import \{ measure \} from ['"][^'"]*profiling['"]\n/gm

function inlineMeasures(contents: string, profile: boolean) {
  let replacements = 0

  let transformed = contents

  if (!profile) {
    transformed = transformed.replace(measureImport, '')
  }

  transformed = transformed.replaceAll(
    measureAwaitConst,
    (
      _match,
      indent: string,
      resultName: string,
      _quote,
      name: string,
      expression: string,
      _savedQuote: string | undefined,
      savedName: string | undefined,
      castType: string | undefined
    ) => {
      replacements++
      const call = expression.replaceAll(/\s+/g, ' ')
      const awaited = castType
        ? `(await ${call}) as ${castType}`
        : `await ${call}`

      if (!profile) {
        return `${indent}const ${resultName} = ${awaited}`
      }

      const lines = [
        `${indent}const ${resultName}StartedAt = Bun.nanoseconds()`,
        `${indent}const ${resultName} = ${awaited}`,
        `${indent}measure.add('${name}', Bun.nanoseconds() - ${resultName}StartedAt)`,
      ]

      if (savedName) {
        lines.push(`${indent}measure.set('${savedName}', ${resultName})`)
      }

      return lines.join('\n')
    }
  )

  transformed = transformed.replaceAll(
    measureConst,
    (
      _match,
      indent: string,
      resultName: string,
      _quote,
      name: string,
      expression: string,
      _savedQuote: string | undefined,
      savedName: string | undefined
    ) => {
      replacements++
      const call = expression.replaceAll(/\s+/g, ' ')

      if (!profile) {
        return `${indent}const ${resultName} = ${call}`
      }

      const lines = [
        `${indent}const ${resultName}StartedAt = Bun.nanoseconds()`,
        `${indent}const ${resultName} = ${call}`,
        `${indent}measure.add('${name}', Bun.nanoseconds() - ${resultName}StartedAt)`,
      ]

      if (savedName) {
        lines.push(`${indent}measure.set('${savedName}', ${resultName})`)
      }

      return lines.join('\n')
    }
  )

  transformed = transformed.replaceAll(
    measureStatement,
    (
      _match,
      indent: string,
      returnPrefix: string | undefined,
      _quote,
      name: string,
      expression: string,
      _savedQuote: string | undefined,
      savedName: string | undefined
    ) => {
      replacements++
      const call = expression.replaceAll(/\s+/g, ' ')

      if (!profile) {
        return `${indent}${returnPrefix ?? ''}${call}`
      }

      const lines = [`${indent}const ${name}StartedAt = Bun.nanoseconds()`]

      if (savedName || returnPrefix) {
        lines.push(`${indent}const ${name}Result = ${call}`)
      } else {
        lines.push(`${indent}${call}`)
      }

      lines.push(
        `${indent}measure.add('${name}', Bun.nanoseconds() - ${name}StartedAt)`
      )

      if (savedName) {
        lines.push(`${indent}measure.set('${savedName}', ${name}Result)`)
      }

      if (returnPrefix) {
        lines.push(`${indent}return ${name}Result`)
      }

      return lines.join('\n')
    }
  )

  transformed = transformed.replaceAll(
    measureCount,
    (
      _match,
      indent: string,
      _quote,
      name: string,
      value: string | undefined
    ) => {
      replacements++

      if (!profile) {
        return ''
      }

      return `${indent}measure.addCounter('${name}', ${value ?? '1'})`
    }
  )

  transformed = transformed.replaceAll(measureControl, (match) => {
    replacements++

    if (!profile) {
      return ''
    }

    return match
  })

  if (
    (contents.includes('measure(') || contents.includes('measure.')) &&
    replacements === 0
  ) {
    throw new Error('measure call shape did not match the build transform')
  }

  if (
    !profile &&
    (transformed.includes('measure(') || transformed.includes('measure.'))
  ) {
    throw new Error('measure call survived the build transform')
  }

  return transformed
}

function measurePlugin(profile: boolean): BunPlugin {
  return {
    name: 'measure-inline',
    setup(build) {
      build.onLoad({ filter: /\/src\/.*\.ts$/ }, async ({ path }) => {
        return {
          contents: inlineMeasures(await Bun.file(path).text(), profile),
          loader: 'ts',
        }
      })
    },
  }
}

async function build(profile: boolean, outfile: string) {
  const result = await Bun.build({
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadPackageJson: false,
      autoloadTsconfig: false,
      outfile,
    },
    entrypoints: ['src/index.ts'],
    target: 'bun',
    format: 'esm',
    bytecode: true,
    sourcemap: 'none',
    minify: true,
    plugins: [measurePlugin(profile)],
  })

  if (result.success) {
    return
  }

  for (const log of result.logs) {
    console.error(log)
  }

  process.exit(1)
}

await mkdir('dist', { recursive: true })

await build(false, 'dist/server')
await build(true, 'dist/server-profile')
