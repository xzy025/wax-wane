import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: '16px', color: '#c43d3d' }}>
            <p>Something went wrong.</p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #ead8cd',
                background: '#fffaf5',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
