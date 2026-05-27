import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary from './ErrorBoundary'

// Suppress React console.error for intentional errors
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

afterAll(() => {
  consoleSpy.mockRestore()
})

function ThrowingComponent() {
  throw new Error('Test error')
}

function SafeComponent() {
  return <div>Child content</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders default fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders custom fallback when provided and a child throws', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingComponent />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Custom error UI')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong.')).not.toBeInTheDocument()
  })

  it('does not render children when error is caught', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    )
    expect(screen.queryByText('Child content')).not.toBeInTheDocument()
  })

  it('Retry button is clickable', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    )
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    expect(retryButton).toBeInTheDocument()
    // Clicking retry resets the error state, but since the child still throws,
    // it will re-catch and show the fallback again.
    await user.click(retryButton)
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
  })

  it('renders multiple children when no error', () => {
    render(
      <ErrorBoundary>
        <div>First child</div>
        <div>Second child</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('First child')).toBeInTheDocument()
    expect(screen.getByText('Second child')).toBeInTheDocument()
  })
})
