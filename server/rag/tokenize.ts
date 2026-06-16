// Shared tokenizer for lexical (BM25) retrieval over mixed Chinese/English text.
//
// pgvector handles the *semantic* side; BM25 needs discrete terms. Chinese has
// no word boundaries, so we approximate: every Han character is a unigram, and
// every adjacent pair is a bigram (so "白酒" matches as a term, not just 白 + 酒).
// English/number runs are lowercased word tokens. This mirrors the token scheme
// used by the embedding fallback in embedding.ts, kept here as the single source
// of truth for lexical matching.

const HAN = /[一-鿿]/

/** Tokenize text into BM25 terms: Han unigrams + Han bigrams + lowercased latin/number words. */
export function tokenize(text: string): string[] {
  if (!text) return []

  const tokens: string[] = []
  const hanChars = text.match(/[一-鿿]/g) ?? []

  // Han unigrams
  for (const ch of hanChars) tokens.push(ch)

  // Han bigrams (only across *adjacent* characters in the original text, so
  // "白酒板块" yields 白酒/酒板/板块 — not arbitrary cross-sentence pairs).
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run[i] + run[i + 1])
    }
  }

  // Latin words and standalone numbers (e.g. "Wyckoff", "R", "300750", "20%")
  for (const word of text.match(/[a-zA-Z]+|\d+(?:\.\d+)?/g) ?? []) {
    tokens.push(word.toLowerCase())
  }

  return tokens
}

/** True if the string contains at least one Han character. */
export function hasHan(text: string): boolean {
  return HAN.test(text)
}
