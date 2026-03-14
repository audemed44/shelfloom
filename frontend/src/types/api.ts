// API Response Types — mirrors backend Pydantic schemas

export interface Shelf {
  id: number
  name: string
  path: string
  is_default: boolean
  is_sync_target: boolean
  book_count: number
}

export interface Series {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  children: Series[]
}

export interface BookSeries {
  series_id: number
  series_name: string
  sequence: number | null
}

export interface ReadingSession {
  id: number
  book_id: number
  started_at: string
  duration_seconds: number
  source: string
  dismissed: boolean
}

export interface Highlight {
  id: number
  book_id: number
  text: string
  note: string | null
  chapter: string | null
  created_at: string
}

export interface ReadingProgress {
  book_id: number
  percent: number
  device: string | null
  updated_at: string
}

export interface Book {
  id: number
  title: string
  author: string | null
  format: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
  date_published: string | null
  description: string | null
  page_count: number | null
  shelf_id: number
  shelf_name: string | null
  file_path: string | null
  shelfloom_id: string | null
  created_at: string
  updated_at: string
}

export interface BookDetail extends Book {
  series: BookSeries[]
  reading_sessions: ReadingSession[]
  highlights: Highlight[]
  reading_progress: ReadingProgress[]
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
}

export interface ApiError {
  status: number
  data: { detail?: string } | null
}
