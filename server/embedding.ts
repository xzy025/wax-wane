// Embedding service - uses existing LLM API with fallback to simple TF-IDF
import { config } from 'dotenv'

config()

const DIMENSION = 1536 // Standard OpenAI embedding dimension

// Simple embedding fallback using character n-grams (works for Chinese)
function simpleEmbed(text: string): number[] {
  const vector = new Array(DIMENSION).fill(0)

  // Extract tokens: Chinese characters (single char) + English words
  const tokens: string[] = []

  // Split into Chinese characters and English words
  const chineseChars = text.match(/[一-鿿]/g) || []
  const englishWords = text.match(/[a-zA-Z]+/g) || []

  // Add individual Chinese characters
  tokens.push(...chineseChars)

  // Add Chinese bigrams for better context
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.push(chineseChars[i] + chineseChars[i + 1])
  }

  // Add English words (lowercase)
  tokens.push(...englishWords.map((w) => w.toLowerCase()))

  // Hash each token to a dimension and accumulate
  for (const token of tokens) {
    let hash = 0
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) | 0
    }
    const dim = Math.abs(hash) % DIMENSION
    vector[dim] += 1
  }

  // Normalize the vector
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm
    }
  }

  return vector
}

export async function embedText(text: string): Promise<number[]> {
  const apiUrl = process.env.LLM_API_URL
  const apiKey = process.env.LLM_API_KEY

  if (!apiUrl || !apiKey) {
    return simpleEmbed(text)
  }

  try {
    // Try to use the embeddings endpoint
    const baseUrl = apiUrl.replace(/\/v1\/chat\/completions$/, '').replace(/\/anthropic$/, '')
    const embeddingsUrl = `${baseUrl}/v1/embeddings`

    const response = await fetch(embeddingsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        input: text,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.ok) {
      const data = await response.json()
      if (data.data?.[0]?.embedding) {
        return data.data[0].embedding
      }
    }
  } catch {
    // API doesn't support embeddings, fall back to simple embedding
  }

  return simpleEmbed(text)
}
