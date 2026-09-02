import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface AtomicJsonReadOptions<T> {
  validate?: (value: unknown) => value is T
}

export function readAtomicJson<T>(
  path: string,
  options: AtomicJsonReadOptions<T> = {},
): T | null {
  if (!existsSync(path)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return options.validate && !options.validate(value) ? null : value as T
  } catch {
    return null
  }
}

/**
 * Writes a complete JSON document and atomically replaces the target.
 * A failed write never truncates the previous last-good file.
 */
export function writeAtomicJson<T>(path: string, value: T): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = path + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 10) + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(temp, path)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
}
