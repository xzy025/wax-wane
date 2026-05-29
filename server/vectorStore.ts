// Embedded vector store using Vectra (pure JS, no external dependencies)
import { LocalIndex } from 'vectra'
import { embedText } from './embedding'
import path from 'path'

const INDEX_DIR = path.join(import.meta.dirname, 'data', 'vector-index')
const COLLECTION_NAME = 'trade_memory'

let index: LocalIndex | null = null

async function getIndex(): Promise<LocalIndex> {
  if (!index) {
    index = new LocalIndex(INDEX_DIR)
    if (!(await index.isIndexCreated())) {
      await index.createIndex()
    }
  }
  return index
}

export interface VectorDocument {
  id: string
  text: string
  metadata: Record<string, unknown>
}

export interface SearchResult {
  id: string
  text: string
  metadata: Record<string, unknown>
  score: number
}

export async function addDocument(doc: VectorDocument): Promise<void> {
  const idx = await getIndex()
  const embedding = await embedText(doc.text)

  // Delete existing document with same ID
  try {
    const existing = await idx.listItems()
    for (const item of existing) {
      if (item.id === doc.id) {
        await idx.deleteItem(item.id)
        break
      }
    }
  } catch {
    // Ignore errors during cleanup
  }

  await idx.insertItem({
    id: doc.id,
    vector: embedding,
    metadata: {
      text: doc.text,
      ...doc.metadata,
    },
  })
}

export async function searchSimilar(
  query: string,
  topK: number = 5,
  type?: string,
): Promise<SearchResult[]> {
  const idx = await getIndex()
  const queryEmbedding = await embedText(query)

  const results = await idx.queryItems(queryEmbedding, topK * 2) // Get more results for filtering

  let items = results.map((r) => ({
    id: r.item.id,
    text: (r.item.metadata as Record<string, unknown>).text as string,
    metadata: r.item.metadata as Record<string, unknown>,
    score: r.score,
  }))

  // Filter by type if specified
  if (type && type !== 'all') {
    items = items.filter((item) => item.metadata.type === type)
  }

  return items.slice(0, topK)
}

export async function deleteDocument(id: string): Promise<void> {
  const idx = await getIndex()
  try {
    const existing = await idx.listItems()
    for (const item of existing) {
      if (item.id === id) {
        await idx.deleteItem(item.id)
        break
      }
    }
  } catch {
    // Document doesn't exist
  }
}

export async function getDocumentCount(): Promise<number> {
  const idx = await getIndex()
  const items = await idx.listItems()
  return items.length
}

export async function clearIndex(): Promise<void> {
  const idx = await getIndex()
  const items = await idx.listItems()
  for (const item of items) {
    await idx.deleteItem(item.id)
  }
}
