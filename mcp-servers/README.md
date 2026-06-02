# TradeReview MCP Servers

MCP (Model Context Protocol) servers for the TradeReview application. These servers expose trading tools that can be used by any MCP client (Claude Desktop, Cursor, etc.).

## Available Servers

### 1. Market Data (`market-data/`)
9 tools for fetching market data:
- `getAShareQuote` - A-share stock quotes
- `getAShareBreadth` - Market breadth (advance/decline)
- `getIndexTrends` - Index intraday trends
- `getLimitPool` - Limit up/down pool
- `getHKData` - Hong Kong market data
- `getUSData` - US market data
- `getMacroIndicators` - Macro indicators (US Treasury, gold, etc.)
- `getNewsSummary` - Financial news summary
- `getHotList` - Hot stock rankings

### 2. RAG (`rag/`)
4 tools for semantic search:
- `semanticSearch` - Search trade history by semantic similarity
- `syncTradeGroups` - Sync trade data to vector store
- `getDocumentCount` - Get vector store statistics
- `hybridSearch` - Combined vector + graph search

### 3. Trade Database (`trade-db/`)
4 tools for database operations:
- `queryTrades` - Query trade records
- `getTradeGroups` - Query trade groups
- `upsertReviewNote` - Create/update review notes
- `getReviewNote` - Get review notes

### 4. Memory + Graph (`memory-graph/`)
8 tools for memory and graph operations:
- `getMemory` - Get user memory
- `updateTradingProfile` - Update trading profile
- `addImprovementPlan` - Add improvement plan
- `updateConversationSummary` - Update conversation summary
- `graphQuery` - Query trade relationship graph
- `findRelatedTrades` - Find related trades
- `findPatternPath` - Find mistake→theory paths
- `getGraphStats` - Get graph statistics

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trade-review-market-data": {
      "command": "node",
      "args": ["path/to/mcp-servers/market-data/src/index.mjs"]
    },
    "trade-review-rag": {
      "command": "node",
      "args": ["path/to/mcp-servers/rag/src/index.mjs"]
    },
    "trade-review-trade-db": {
      "command": "node",
      "args": ["path/to/mcp-servers/trade-db/src/index.mjs"]
    },
    "trade-review-memory-graph": {
      "command": "node",
      "args": ["path/to/mcp-servers/memory-graph/src/index.mjs"]
    }
  }
}
```

## Environment Variables

All servers use these environment variables:
- `PG_HOST` - PostgreSQL host (default: localhost)
- `PG_PORT` - PostgreSQL port (default: 5432)
- `PG_DATABASE` - Database name (default: trade_review)
- `PG_USER` - Database user (default: postgres)
- `PG_PASSWORD` - Database password (default: postgres)

## Total Tools: 25

| Server | Tools |
|--------|-------|
| Market Data | 9 |
| RAG | 4 |
| Trade DB | 4 |
| Memory + Graph | 8 |
| **Total** | **25** |
