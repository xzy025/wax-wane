import zh from './zh'
import en from './en'

export { zh, en }

/** Replace {0}, {1}, ... placeholders in a translation template with the given values. */
export function fmt(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)]
    return value === undefined ? match : String(value)
  })
}
