import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookCard from '../components/library/BookCard'
import type { Book } from '../types'

const BOOK: Book = {
  id: 1,
  title: 'The Way of Kings',
  author: 'Brandon Sanderson',
  format: 'epub',
  page_count: 1007,
  shelf_id: 1,
  shelf_name: 'Library',
  file_path: null,
  shelfloom_id: null,
  publisher: null,
  language: null,
  isbn: null,
  date_published: null,
  description: null,
  created_at: '2024-01-01T00:00:00',
  updated_at: '2024-01-01T00:00:00',
}

function renderCard(book: Book = BOOK) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
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
    expect(link.getAttribute('href')).toBe('/books/1')
  })

  it('renders without author when author is absent', () => {
    renderCard({ ...BOOK, author: null })
    expect(screen.queryByText('Brandon Sanderson')).not.toBeInTheDocument()
    expect(screen.getByText('The Way of Kings')).toBeInTheDocument()
  })

  it('renders cover image with correct src', () => {
    renderCard()
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('/api/books/1/cover')
  })
})
