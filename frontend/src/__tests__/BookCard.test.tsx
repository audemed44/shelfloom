import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookCard from '../components/library/BookCard'
import type { Book } from '../types'

const BOOK: Book = {
  id: 'test-uuid-1',
  title: 'The Way of Kings',
  author: 'Brandon Sanderson',
  status: 'unread',
  rating: null,
  has_review: false,
  format: 'epub',
  page_count: 1007,
  shelf_id: 1,
  shelf_name: 'Library',
  file_path: null,
  shelfloom_id: null,
  cover_path: '/covers/test-uuid-1.jpg',
  publisher: null,
  language: null,
  isbn: null,
  date_published: null,
  description: null,
  created_at: '2024-01-01T00:00:00',
  updated_at: '2024-01-01T00:00:00',
  genres: [],
  reading_progress: null,
  last_read: null,
  series_id: null,
  series_name: null,
  series_sequence: null,
  tags: [],
}

function renderCard(
  book: Book = BOOK,
  selectionProps?: {
    isSelecting?: boolean
    isSelected?: boolean
    onToggle?: (id: string) => void
  }
) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <BookCard book={book} {...selectionProps} />
    </MemoryRouter>
  )
}

describe('BookCard', () => {
  it('renders the book title', () => {
    renderCard()
    expect(screen.getByText('The Way of Kings')).toBeInTheDocument()
  })

  it('renders the author', () => {
    renderCard()
    expect(screen.getByText('Brandon Sanderson')).toBeInTheDocument()
  })

  it('renders the format badge', () => {
    renderCard()
    expect(screen.getByText('Epub')).toBeInTheDocument()
  })

  it('links to the book detail page', () => {
    renderCard()
    const link = screen.getByTestId('book-card')
    expect(link.getAttribute('href')).toBe('/books/test-uuid-1')
  })

  it('renders without author when author is absent', () => {
    renderCard({ ...BOOK, author: null })
    expect(screen.queryByText('Brandon Sanderson')).not.toBeInTheDocument()
    expect(screen.getByText('The Way of Kings')).toBeInTheDocument()
  })

  it('renders cover image with correct src', () => {
    renderCard()
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('/api/books/test-uuid-1/cover')
    expect(img.getAttribute('src')).toContain(
      'cover=%2Fcovers%2Ftest-uuid-1.jpg'
    )
  })

  it('does not show checkbox when onToggle is not provided', () => {
    renderCard()
    expect(screen.queryByTestId('book-select-checkbox')).not.toBeInTheDocument()
  })

  it('shows checkbox when onToggle is provided', () => {
    renderCard(BOOK, { onToggle: vi.fn() })
    expect(screen.getByTestId('book-select-checkbox')).toBeInTheDocument()
  })

  it('calls onToggle with book id when clicked in selecting mode', async () => {
    const onToggle = vi.fn()
    renderCard(BOOK, { isSelecting: true, onToggle })
    await userEvent.click(screen.getByTestId('book-card'))
    expect(onToggle).toHaveBeenCalledWith('test-uuid-1')
  })

  it('renders as div instead of link when selecting', () => {
    renderCard(BOOK, { isSelecting: true, onToggle: vi.fn() })
    const card = screen.getByTestId('book-card')
    expect(card.tagName).toBe('DIV')
    expect(card.getAttribute('href')).toBeNull()
  })

  it('shows a DNF badge for dropped books', () => {
    renderCard({ ...BOOK, status: 'dnf' })
    expect(screen.getByTestId('book-card-dnf-badge')).toBeInTheDocument()
  })

  it('submits a quick rating from the inline stars', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)

    renderCard()
    const ratingButtons = screen.getAllByLabelText('Rate 4 stars')
    await user.click(ratingButtons[0])

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/books/test-uuid-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ rating: 4 }),
      })
    )

    fetchSpy.mockRestore()
  })
})
