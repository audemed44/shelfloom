import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import BookCard from '../library/BookCard'
import BookRow from '../library/BookRow'
import SeriesCard from '../library/SeriesCard'
import SeriesRow from '../library/SeriesRow'
import type { Book } from '../../types'

interface BookGroup {
  seriesId: number | null
  seriesName: string | null
  books: Book[]
}

interface GroupedBookContentProps {
  books: Book[]
  view: 'grid' | 'list'
  groupBySeries: boolean
  expandedSeriesIds: Set<number>
  onToggleSeriesExpanded: (seriesId: number) => void
  isSelecting?: boolean
  selectedIds?: Set<string>
  onToggleSelection?: (id: string) => void
  onToggleSeriesSelection?: (bookIds: string[]) => void
}

function buildBookGroups(books: Book[], groupBySeries: boolean): BookGroup[] {
  if (!groupBySeries) return [{ seriesId: null, seriesName: null, books }]

  const entries: BookGroup[] = []
  const seriesIndexMap = new Map<number, number>()

  for (const book of books) {
    if (book.series_id != null && book.series_name) {
      const existingIdx = seriesIndexMap.get(book.series_id)
      if (existingIdx != null) {
        const group = entries[existingIdx]
        group.books.push(book)
        group.books.sort((a, b) => {
          const sa = a.series_sequence ?? Infinity
          const sb = b.series_sequence ?? Infinity
          return sa - sb
        })
      } else {
        seriesIndexMap.set(book.series_id, entries.length)
        entries.push({
          seriesId: book.series_id,
          seriesName: book.series_name,
          books: [book],
        })
      }
    } else {
      entries.push({ seriesId: null, seriesName: null, books: [book] })
    }
  }

  return entries
}

export default function GroupedBookContent({
  books,
  view,
  groupBySeries,
  expandedSeriesIds,
  onToggleSeriesExpanded,
  isSelecting = false,
  selectedIds,
  onToggleSelection,
  onToggleSeriesSelection,
}: GroupedBookContentProps) {
  const bookGroups = useMemo(
    () => buildBookGroups(books, groupBySeries),
    [books, groupBySeries]
  )

  if (view === 'grid') {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4"
        data-testid="book-grid"
      >
        {bookGroups.flatMap((group) => {
          if (
            groupBySeries &&
            group.seriesId != null &&
            !expandedSeriesIds.has(group.seriesId)
          ) {
            const seriesBookIds = group.books.map((book) => book.id)
            const allSeriesSelected =
              seriesBookIds.length > 0 &&
              seriesBookIds.every((id) => selectedIds?.has(id))
            const someSeriesSelected =
              !allSeriesSelected &&
              seriesBookIds.some((id) => selectedIds?.has(id))

            return [
              <SeriesCard
                key={`series-${group.seriesId}`}
                seriesId={group.seriesId}
                seriesName={group.seriesName!}
                books={group.books}
                onExpand={() => onToggleSeriesExpanded(group.seriesId!)}
                isSelecting={isSelecting}
                isAllSelected={allSeriesSelected}
                isPartiallySelected={someSeriesSelected}
                onToggleAll={
                  onToggleSeriesSelection
                    ? () => onToggleSeriesSelection(seriesBookIds)
                    : undefined
                }
              />,
            ]
          }

          if (
            groupBySeries &&
            group.seriesId != null &&
            expandedSeriesIds.has(group.seriesId)
          ) {
            return [
              <div
                key={`series-header-${group.seriesId}`}
                className="col-span-full"
              >
                <button
                  onClick={() => onToggleSeriesExpanded(group.seriesId!)}
                  className="flex items-center gap-3 border-b border-white/10 pb-2 mb-4 mt-4 first:mt-0 w-full bg-transparent p-0 text-left cursor-pointer"
                  data-testid="series-expanded-header"
                >
                  <ChevronDown size={14} className="text-primary" />
                  <span className="text-[10px] font-black tracking-widest uppercase text-white/40">
                    {group.seriesName}
                  </span>
                  <span className="text-[10px] font-bold tracking-wider text-white/20">
                    {group.books.length}
                  </span>
                </button>
              </div>,
              ...group.books.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  isSelecting={isSelecting}
                  isSelected={selectedIds?.has(book.id)}
                  onToggle={onToggleSelection}
                />
              )),
            ]
          }

          return group.books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              isSelecting={isSelecting}
              isSelected={selectedIds?.has(book.id)}
              onToggle={onToggleSelection}
            />
          ))
        })}
      </div>
    )
  }

  return (
    <div className="space-y-px" data-testid="book-list">
      {bookGroups.flatMap((group) => {
        if (
          groupBySeries &&
          group.seriesId != null &&
          !expandedSeriesIds.has(group.seriesId)
        ) {
          const seriesBookIds = group.books.map((book) => book.id)
          const allSeriesSelected =
            seriesBookIds.length > 0 &&
            seriesBookIds.every((id) => selectedIds?.has(id))
          const someSeriesSelected =
            !allSeriesSelected &&
            seriesBookIds.some((id) => selectedIds?.has(id))

          return [
            <SeriesRow
              key={`series-${group.seriesId}`}
              seriesId={group.seriesId}
              seriesName={group.seriesName!}
              books={group.books}
              onExpand={() => onToggleSeriesExpanded(group.seriesId!)}
              isSelecting={isSelecting}
              isAllSelected={allSeriesSelected}
              isPartiallySelected={someSeriesSelected}
              onToggleAll={
                onToggleSeriesSelection
                  ? () => onToggleSeriesSelection(seriesBookIds)
                  : undefined
              }
            />,
          ]
        }

        if (
          groupBySeries &&
          group.seriesId != null &&
          expandedSeriesIds.has(group.seriesId)
        ) {
          return [
            <button
              key={`series-header-${group.seriesId}`}
              onClick={() => onToggleSeriesExpanded(group.seriesId!)}
              className="flex items-center gap-3 p-4 bg-white/5 border border-primary/30 w-full text-left cursor-pointer"
              data-testid="series-expanded-header"
            >
              <ChevronDown size={14} className="text-primary" />
              <span className="text-[10px] font-black tracking-widest uppercase text-white/60">
                {group.seriesName}
              </span>
              <span className="text-[10px] font-bold tracking-wider text-white/30">
                {group.books.length}
              </span>
            </button>,
            ...group.books.map((book) => (
              <BookRow
                key={book.id}
                book={book}
                isSelecting={isSelecting}
                isSelected={selectedIds?.has(book.id)}
                onToggle={onToggleSelection}
              />
            )),
          ]
        }

        return group.books.map((book) => (
          <BookRow
            key={book.id}
            book={book}
            isSelecting={isSelecting}
            isSelected={selectedIds?.has(book.id)}
            onToggle={onToggleSelection}
          />
        ))
      })}
    </div>
  )
}
