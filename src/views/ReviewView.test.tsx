import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Translation, TradeGroup, ReviewNote } from '../types'
import en from '../i18n/en'

const t = en as Translation

const mockTradeGroups: TradeGroup[] = [
  {
    id: 'tg-001',
    code: '300750',
    name: 'CATL',
    opened: '2026-03-04',
    closed: '2026-03-18',
    pnl: 8460,
    returnRate: 9.4,
    days: 14,
    totalFee: 324.6,
    strategy: 'Pullback',
    mistakes: ['Early profit taking'],
    status: 'Reviewed',
  },
  {
    id: 'tg-002',
    code: '600519',
    name: 'Kweichow Moutai',
    opened: '2026-03-12',
    closed: '2026-03-21',
    pnl: -3920,
    returnRate: -3.1,
    days: 9,
    totalFee: 204.8,
    strategy: 'Index beta',
    mistakes: ['No plan', 'Late stop loss'],
    status: 'Follow up',
  },
]

const mockDispatch = vi.fn()

// Stable references to prevent infinite re-render loops
const mockState = {
  trades: [] as never[],
  tradeGroups: mockTradeGroups,
  reviewNotes: {} as Record<string, unknown>,
  importBatches: [] as never[],
}

// Mock store
vi.mock('../store', () => ({
  useAppState: () => mockState,
  useAppDispatch: () => mockDispatch,
  StoreProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock ChatPanel - completely replace to avoid agent dependencies
vi.mock('../agent/components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel">AI Review Assistant</div>,
}))

// Dynamic import after mocks
const { default: ReviewView } = await import('./ReviewView')

describe('ReviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const selectedGroup = mockTradeGroups[0]

  it('renders the group list panel title', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('Trade Groups')).toBeInTheDocument()
    expect(screen.getByText('Select a stock cycle to review.')).toBeInTheDocument()
  })

  it('renders all trade group names in the list', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const groupListPanel = container.querySelector('.group-list')!
    expect(groupListPanel).toHaveTextContent('CATL')
    expect(groupListPanel).toHaveTextContent('Kweichow Moutai')
  })

  it('renders trade group codes', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const groupListPanel = container.querySelector('.group-list')!
    expect(groupListPanel).toHaveTextContent('300750')
    expect(groupListPanel).toHaveTextContent('600519')
  })

  it('highlights the selected group with active class', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const buttons = screen.getAllByRole('button')
    const catlButton = buttons.find(
      (b) => b.textContent?.includes('CATL') && b.className.includes('active'),
    )
    expect(catlButton).toBeDefined()
  })

  it('calls onSelectGroup when a group is clicked', async () => {
    const user = userEvent.setup()
    const onSelectGroup = vi.fn()
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={onSelectGroup}
      />,
    )
    await user.click(screen.getByText('Kweichow Moutai'))
    expect(onSelectGroup).toHaveBeenCalledWith('tg-002')
  })

  it('renders the selected group detail header', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const detail = container.querySelector('.review-detail')!
    expect(detail).toHaveTextContent('300750')
    expect(detail).toHaveTextContent('CATL')
  })

  it('renders PnL with correct formatting', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const pnlBox = container.querySelector('.pnl-box')!
    expect(pnlBox).toHaveTextContent('+¥8,460')
  })

  it('renders return rate', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('9.4%')).toBeInTheDocument()
  })

  it('renders holding period', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const heading = container.querySelector('.review-heading')!
    expect(heading).toHaveTextContent('14')
    expect(heading).toHaveTextContent('days')
  })

  it('renders review form textareas', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('Buy Reason')).toBeInTheDocument()
    expect(screen.getByText('Sell Reason')).toBeInTheDocument()
    expect(screen.getByText('Execution Review')).toBeInTheDocument()
    expect(screen.getByText('Lesson')).toBeInTheDocument()
  })

  it('renders textarea placeholders', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(
      screen.getByPlaceholderText('Price pulled back to prior support with volume contraction.'),
    ).toBeInTheDocument()
  })

  it('dispatches UPDATE_REVIEW_NOTE when textarea changes', async () => {
    const user = userEvent.setup()
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const buyReasonTextarea = screen.getByPlaceholderText(
      'Price pulled back to prior support with volume contraction.',
    )
    await user.type(buyReasonTextarea, 'A')
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_REVIEW_NOTE',
        payload: expect.objectContaining({ groupId: 'tg-001' }),
      }),
    )
  })

  it('renders strategy tag', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('Pullback')).toBeInTheDocument()
  })

  it('renders mistake tags for the selected group', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('Early profit taking')).toBeInTheDocument()
  })

  it('renders no mistake message when group has no mistakes', () => {
    const noMistakeGroup = { ...selectedGroup, mistakes: [] }
    render(
      <ReviewView
        t={t}
        selectedGroup={noMistakeGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('No mistake tag')).toBeInTheDocument()
  })

  it('renders the AI agent chat section', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText('AI Review Assistant')).toBeInTheDocument()
  })

  it('shows open status for groups without close date', () => {
    const openGroup: TradeGroup = {
      ...selectedGroup,
      closed: null,
    }
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={openGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const heading = container.querySelector('.review-heading')!
    expect(heading).toHaveTextContent('open')
  })

  it('renders closed date for closed groups', () => {
    render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    expect(screen.getByText(/2026-03-18/)).toBeInTheDocument()
  })

  it('renders PnL box with positive class for profitable group', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={selectedGroup}
        selectedGroupId="tg-001"
        onSelectGroup={vi.fn()}
      />,
    )
    const pnlBox = container.querySelector('.pnl-box.positive')
    expect(pnlBox).toBeInTheDocument()
  })

  it('renders PnL box with negative class for losing group', () => {
    const { container } = render(
      <ReviewView
        t={t}
        selectedGroup={mockTradeGroups[1]}
        selectedGroupId="tg-002"
        onSelectGroup={vi.fn()}
      />,
    )
    const pnlBox = container.querySelector('.pnl-box.negative')
    expect(pnlBox).toBeInTheDocument()
  })
})
