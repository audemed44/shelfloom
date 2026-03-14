import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookCard from '../components/library/BookCard'

const BOOK = {
  id: 'abc-123',
  title: 'The Way of Kings',
  author: 'Brandon Sanderson',
  format: 'epub',
  page_count: 1007,
}

function renderCard(book = BOOK) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BookCard book={book} />
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
    expect(screen.getByText('EPUB')).toBeInTheDocument()
  })

  it('links to the book detail page', () => {
    renderCard()
    const link = screen.getByTestId('book-card')
    expect(link.getAttribute('href')).toBe('/books/abc-123')
  })

  it('renders without author when author is absent', () => {
    renderCard({ ...BOOK, author: null })
    expect(screen.queryByText('Brandon Sanderson')).not.toBeInTheDocument()
    expect(screen.getByText('The Way of Kings')).toBeInTheDocument()
  })

  it('renders cover image with correct src', () => {
    renderCard()
    const img = screen.getByRole('img')
    expect(img.src).toContain('/api/books/abc-123/cover')
  })
})
