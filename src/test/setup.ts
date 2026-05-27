import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock scrollIntoView for jsdom (not available in test environment)
Element.prototype.scrollIntoView = vi.fn()
