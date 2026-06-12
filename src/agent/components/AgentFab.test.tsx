import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentFab } from './AgentFab'
import { AgentProvider } from '../agentStore'

function renderFab(label?: string) {
  return render(
    <AgentProvider>
      <AgentFab label={label} />
    </AgentProvider>,
  )
}

describe('AgentFab', () => {
  it('uses the default title when no label is given', () => {
    renderFab()
    expect(screen.getByRole('button')).toHaveAttribute('title', 'AI Assistant')
  })

  it('uses the provided label as title', () => {
    renderFab('AI 助手')
    expect(screen.getByRole('button')).toHaveAttribute('title', 'AI 助手')
  })

  it('starts closed and toggles the panel on click', async () => {
    const user = userEvent.setup()
    renderFab()
    const fab = screen.getByRole('button')
    expect(fab).not.toHaveClass('ai-fab-active')
    await user.click(fab)
    expect(fab).toHaveClass('ai-fab-active')
    await user.click(fab)
    expect(fab).not.toHaveClass('ai-fab-active')
  })
})
