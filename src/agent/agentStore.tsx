import React, { createContext, useContext, useReducer, useRef, type ReactNode } from 'react'
import type { AgentState, AgentAction, AgentMessage, ConversationMessage } from './types'

const initialState: AgentState = {
  conversations: [],
  activeConversationId: null,
  isProcessing: false,
  memory: { facts: [], lastUpdated: '' },
  isOpen: false,
}

function reducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'TOGGLE_PANEL':
      return { ...state, isOpen: !state.isOpen }

    case 'START_CONVERSATION': {
      const id = `conv-${Date.now()}`
      return {
        ...state,
        conversations: [
          ...state.conversations,
          { id, messages: [], createdAt: new Date().toISOString() },
        ],
        activeConversationId: id,
        isOpen: true,
      }
    }

    case 'ADD_USER_MESSAGE': {
      if (!state.activeConversationId) return state
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === state.activeConversationId
            ? { ...c, messages: [...c.messages, action.payload] }
            : c,
        ),
      }
    }

    case 'ADD_ASSISTANT_MESSAGE': {
      if (!state.activeConversationId) return state
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === state.activeConversationId
            ? { ...c, messages: [...c.messages, action.payload] }
            : c,
        ),
      }
    }

    case 'UPDATE_TOOL_CALL': {
      if (!state.activeConversationId) return state
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === state.activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id !== action.payload.messageId) return m
                  const existing = m.toolCalls ?? []
                  const idx = existing.findIndex(
                    (tc) => tc.toolId === action.payload.toolCall.toolId,
                  )
                  if (idx >= 0) {
                    const updated = [...existing]
                    updated[idx] = action.payload.toolCall
                    return { ...m, toolCalls: updated }
                  }
                  return { ...m, toolCalls: [...existing, action.payload.toolCall] }
                }),
              }
            : c,
        ),
      }
    }

    case 'STREAM_TOKEN': {
      if (!state.activeConversationId) return state
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === state.activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === action.payload.messageId
                    ? { ...m, content: m.content + action.payload.token }
                    : m,
                ),
              }
            : c,
        ),
      }
    }

    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.payload }

    case 'CLEAR_CONVERSATION': {
      if (!state.activeConversationId) return state
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === state.activeConversationId ? { ...c, messages: [] } : c,
        ),
      }
    }

    default:
      return state
  }
}

// Context
const StateContext = createContext<AgentState>(initialState)
const DispatchContext = createContext<React.Dispatch<AgentAction>>(() => {})
const HistoryContext = createContext<React.MutableRefObject<Map<string, AgentMessage[]>>>({
  current: new Map(),
})

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const historyRef = useRef(new Map<string, AgentMessage[]>())

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <HistoryContext.Provider value={historyRef}>{children}</HistoryContext.Provider>
      </DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useAgentState() {
  return useContext(StateContext)
}

export function useAgentDispatch() {
  return useContext(DispatchContext)
}

export function useAgentHistory() {
  return useContext(HistoryContext)
}

export function useActiveConversation(): readonly ConversationMessage[] {
  const state = useAgentState()
  const conv = state.conversations.find((c) => c.id === state.activeConversationId)
  return conv?.messages ?? []
}
