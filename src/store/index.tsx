import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react'
import type { ParsedTrade, ReviewNote, TradeGroup } from '../types'
import { tradeGroups as mockTradeGroups } from '../data/mock'
import {
  probeBackendDb,
  syncImportBatch,
  syncReviewNote,
  syncTradeGroups,
  syncTrades,
} from './persistence'

export interface ImportBatch {
  id: string
  filename: string
  importedAt: string
  rowCount: number
  status: 'draft' | 'imported' | 'failed'
}

export interface AppState {
  trades: ParsedTrade[]
  tradeGroups: TradeGroup[]
  reviewNotes: Record<string, ReviewNote>
  importBatches: ImportBatch[]
}

type Action =
  | { type: 'ADD_TRADES'; payload: ParsedTrade[] }
  | { type: 'SET_TRADE_GROUPS'; payload: TradeGroup[] }
  | { type: 'UPDATE_REVIEW_NOTE'; payload: { groupId: string; note: ReviewNote } }
  | { type: 'UPDATE_TRADE'; payload: { index: number; trade: ParsedTrade } }
  | { type: 'ADD_IMPORT_BATCH'; payload: ImportBatch }
  | { type: 'LOAD_STATE'; payload: Partial<AppState> }

const STORAGE_KEY = 'trade-review-state'

function loadFromStorage(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveToStorage(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

const initialState: AppState = {
  trades: [],
  tradeGroups: mockTradeGroups,
  reviewNotes: {},
  importBatches: [],
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TRADES':
      return { ...state, trades: [...state.trades, ...action.payload] }
    case 'SET_TRADE_GROUPS':
      return { ...state, tradeGroups: action.payload }
    case 'UPDATE_REVIEW_NOTE':
      return {
        ...state,
        reviewNotes: {
          ...state.reviewNotes,
          [action.payload.groupId]: action.payload.note,
        },
      }
    case 'UPDATE_TRADE': {
      const trades = [...state.trades]
      trades[action.payload.index] = action.payload.trade
      return { ...state, trades }
    }
    case 'ADD_IMPORT_BATCH':
      return { ...state, importBatches: [...state.importBatches, action.payload] }
    case 'LOAD_STATE':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

const StateContext = createContext<AppState>(initialState)
const DispatchContext = createContext<React.Dispatch<Action>>(() => {})

/**
 * Mirror a state-mutating action to the backend on a best-effort basis. Runs
 * after the pure reducer dispatch; each sync helper no-ops when the backend DB
 * is unavailable, so this is a transparent enhancement over localStorage.
 */
function syncAction(action: Action): void {
  switch (action.type) {
    case 'ADD_TRADES':
      syncTrades(action.payload)
      break
    case 'SET_TRADE_GROUPS':
      syncTradeGroups(action.payload)
      break
    case 'UPDATE_REVIEW_NOTE':
      syncReviewNote(action.payload.groupId, action.payload.note)
      break
    case 'ADD_IMPORT_BATCH':
      syncImportBatch(action.payload)
      break
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    ...loadFromStorage(),
  }))

  useEffect(() => {
    saveToStorage(state)
  }, [state])

  // Detect backend DB availability once; enables write-through sync.
  useEffect(() => {
    void probeBackendDb()
  }, [])

  // Dispatch wrapper: pure state update first, then best-effort backend sync.
  const enhancedDispatch = useCallback<React.Dispatch<Action>>((action) => {
    dispatch(action)
    syncAction(action)
  }, [])

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={enhancedDispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useAppState() {
  return useContext(StateContext)
}

export function useAppDispatch() {
  return useContext(DispatchContext)
}
