// Pure helpers for reading archived fundamental reports back out of
// docs/fundamentals/. Zero IO — the route layer does the fs/db work.

export interface ArchiveFileRef {
  filename: string
  code: string
  /** YYYY-MM-DD, taken from the filename (UTC date at archive time) */
  date: string
}

const REPORT_FILENAME_RE = /^(\d{6})-(\d{4}-\d{2}-\d{2})\.md$/

/** Parse a `{code}-{YYYY-MM-DD}.md` archive filename; anything else → null. */
export function parseReportFilename(filename: string): ArchiveFileRef | null {
  const m = REPORT_FILENAME_RE.exec(filename)
  if (!m) return null
  return { filename, code: m[1], date: m[2] }
}

/** Pick the newest archived report for a stock code from a directory listing. */
export function pickLatestReportFile(filenames: string[], code: string): ArchiveFileRef | null {
  let latest: ArchiveFileRef | null = null
  for (const filename of filenames) {
    const ref = parseReportFilename(filename)
    if (!ref || ref.code !== code) continue
    // ISO dates sort lexicographically in chronological order.
    if (!latest || ref.date > latest.date) latest = ref
  }
  return latest
}

/**
 * Extract the stock name from the report's first heading, e.g.
 * `# 宁德时代 (300750) — 一页纸速览 (…)`. The trailing parenthetical is
 * LLM-generated free text — only the name before the 6-digit code is trusted.
 */
export function extractStockNameFromReport(reportMd: string): string | null {
  const m = /^#\s*(.+?)\s*[（(]\s*\d{6}\s*[)）]/m.exec(reportMd)
  return m ? m[1].trim() || null : null
}

/** Same summary rule as archiveReport's RAG row, so file/db stay consistent. */
export function summarizeReport(reportMd: string, maxLen = 280): string {
  return reportMd.replace(/\s+/g, ' ').slice(0, maxLen)
}
