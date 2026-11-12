import { readFile, writeFile } from 'node:fs/promises'

/** Keep editor saves intact while the browser verifier temporarily changes real HMR sources. */
export async function withHmrEdits(changes, verify) {
  const sources = new Map()
  for (const { path, transform } of changes) {
    const original = await readFile(path, 'utf8')
    const changed = transform(original)
    if (changed === original) throw new Error(`HMR probe did not change ${path}`)
    sources.set(path, { original, changed, expected: original })
  }

  async function apply(path) {
    const source = sources.get(path)
    const current = await readFile(path, 'utf8')
    if (current !== source.expected) throw conflict(path)
    source.expected = source.changed
    await writeFile(path, source.changed)
  }

  async function restore(paths = [...sources.keys()]) {
    const failures = []
    for (const path of paths) {
      try {
        const source = sources.get(path)
        const current = await readFile(path, 'utf8')
        if (current !== source.original) {
          if (current !== source.expected) throw conflict(path)
          await writeFile(path, source.original)
        }
        source.expected = source.original
      } catch (error) {
        failures.push(new Error(`Cannot restore ${path}: ${error.message}`, { cause: error }))
      }
    }
    if (failures.length) throw new AggregateError(failures, 'HMR source restoration failed')
  }

  const failures = []
  try {
    await verify({ apply, restore })
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      await restore()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'HMR verification failed')
}

function conflict(path) {
  return new Error(`Concurrent edit in ${path}; preserving current content`)
}
