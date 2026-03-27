// API Response Types — mirrors backend Pydantic schemas

export interface Shelf {
  id: number
  name: string
  path: string
  is_default: boolean
  is_sync_target: boolean
  device_name: string | null
  koreader_stats_db_path: string | null
  auto_organize: boolean
  created_at: string
  book_count: number
  organize_template: string | null
  seq_pad: number
}

export interface OrganizerResult {
  book_id: string
  book_title: string
  old_path: string
  new_path: string
  moved: boolean
  already_correct: boolean
  error: string | null
}

export interface ScanProgress {
  total: number
  processed: number
  created: number
  updated: number
  skipped: number
  errors: number
}

export interface ScanStatus {
  is_running: boolean
  last_scan_at: string | null
  progress: ScanProgress | null
  error: string | null
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

export interface Tag {
  id: number
  name: string
}

export interface Genre {
  id: number
  name: string
}

export interface Author {
  name: string
}

export interface FilterState {
  genres: number[]
  tags: number[]
  seriesIds: number[]
  authors: string[]
  formats: string[]
  mode: 'and' | 'or'
}

export interface FilterLabels {
  genres: Record<number, string>
  tags: Record<number, string>
  series: Record<number, string>
}

export interface BulkBookActionResult {
  book_id: string
  success: boolean
  error: string | null
}

export interface BulkBookActionResponse {
  results: BulkBookActionResult[]
  total: number
  succeeded: number
  failed: number
}

export interface ReadingSession {
  id: number
  book_id: string
  started_at: string
  duration_seconds: number
  source: string
  dismissed: boolean
}

export interface Highlight {
  id: number
  book_id: string
  text: string
  note: string | null
  chapter: string | null
  created_at: string
}

export interface ReadingProgress {
  book_id: string
  percent: number
  device: string | null
  updated_at: string
}

export interface Book {
  id: string
  title: string
  author: string | null
  format: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
  date_published: string | null
  genres: Genre[]
  description: string | null
  page_count: number | null
  shelf_id: number
  shelf_name: string | null
  file_path: string | null
  shelfloom_id: string | null
  created_at: string
  updated_at: string
  reading_progress: number | null // 0–100, null = unread
  last_read: string | null
  series_id: number | null
  series_name: string | null
  series_sequence: number | null
  tags: Tag[]
}

export interface BookDetail extends Omit<Book, 'reading_progress'> {
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

export interface SeriesWithCount {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  parent_name: string | null
  sort_order: number
  cover_path: string | null
  book_count: number
  first_book_id: string | null
}

export interface ReadingOrder {
  id: number
  name: string
  series_id: number
  entries: ReadingOrderEntry[]
}

export interface ReadingOrderEntry {
  id: number
  reading_order_id: number
  book_id: string
  position: number
  note: string | null
  title: string | null
  author: string | null
  format: string | null
  cover_path: string | null
}

export interface SeriesBook {
  book_id: string
  sequence: number | null
  title: string
  author: string | null
  format: string | null
  cover_path: string | null
}

export interface LensFilterState {
  genres: number[]
  tags: number[]
  series_ids: number[]
  authors: string[]
  formats: string[]
  mode: 'and' | 'or'
  shelf_id: number | null
  status: string | null
}

export interface Lens {
  id: number
  name: string
  filter_state: LensFilterState
  book_count: number
  cover_book_id: string | null
  created_at: string
  updated_at: string
}

export interface BackfillCoversResponse {
  refreshed: number
  failed: number
  skipped: number
}

// ── Data Management (step 4.5) ──────────────────────────────────────────────

export interface DuplicateSessionOut {
  id: number
  book_id: string
  start_time: string | null
  duration: number | null
  pages_read: number | null
  source: string
  dismissed: boolean
}

export interface DuplicateSessionPair {
  dismissed: DuplicateSessionOut
  active: DuplicateSessionOut | null
}

export interface DuplicateSessionGroup {
  book_id: string
  book_title: string
  book_author: string | null
  pairs: DuplicateSessionPair[]
}

export interface UnmatchedEntry {
  id: number
  title: string
  author: string | null
  source: string
  source_path: string | null
  session_count: number
  total_duration_seconds: number
  dismissed: boolean
  linked_book_id: string | null
  created_at: string
}

export interface DuplicateBookSummary {
  id: string
  title: string
  author: string | null
  format: string
  shelf_id: number
  date_added: string
  session_count: number
}

export interface DuplicateBookGroup {
  books: DuplicateBookSummary[]
}

export interface ImportLogEntry {
  id: number
  book_id: string
  book_title: string
  book_author: string | null
  hash_sha: string
  hash_md5: string
  page_count: number | null
  recorded_at: string
}

export interface ImportLogResponse {
  items: ImportLogEntry[]
  total: number
  limit: number
  offset: number
}

export interface SessionLogEntry {
  id: number
  book_id: string
  book_title: string
  book_author: string | null
  source: string
  start_time: string | null
  duration: number | null
  pages_read: number | null
  device: string | null
  dismissed: boolean
  created_at: string | null
}

export interface SessionLogResponse {
  items: SessionLogEntry[]
  total: number
  limit: number
  offset: number
}

export interface ManualBookCreate {
  title: string
  author?: string | null
  isbn?: string | null
  format?: string
  publisher?: string | null
  language?: string | null
  description?: string | null
  page_count?: number | null
  date_published?: string | null
}

export interface ManualSessionCreate {
  start_time: string
  duration?: number | null
  pages_read?: number | null
}

// ── Web Serials ──────────────────────────────────────────────────────────────

export interface WebSerial {
  id: number
  url: string
  source: string
  title: string | null
  author: string | null
  description: string | null
  cover_path: string | null
  cover_url: string | null
  status: string // "ongoing" | "completed" | "paused" | "error"
  total_chapters: number
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  series_id: number | null
}

export interface SerialChapter {
  id: number
  serial_id: number
  chapter_number: number
  title: string | null
  source_url: string
  publish_date: string | null
  word_count: number | null
  estimated_pages: number | null
  running_word_count: number
  running_estimated_pages: number | null
  running_is_partial: boolean
  fetched_at: string | null
  has_content: boolean
}

export interface ChapterFetchLogEntry {
  timestamp: string
  level: string
  message: string
  chapter_number: number | null
}

export interface ChapterFetchJobResponse {
  serial_id: number
  state: string
  start: number
  end: number
  total: number
  started_at: string
}

export interface ChapterFetchStatusResponse {
  serial_id: number
  state: string
  start: number | null
  end: number | null
  total: number
  processed: number
  fetched: number
  skipped: number
  failed: number
  current_chapter_number: number | null
  current_chapter_title: string | null
  started_at: string | null
  finished_at: string | null
  logs: ChapterFetchLogEntry[]
  error: string | null
}

export interface SerialVolume {
  id: number
  serial_id: number
  book_id: string | null
  volume_number: number
  name: string | null
  cover_path: string | null
  chapter_start: number
  chapter_end: number
  generated_at: string | null
  is_stale: boolean
  estimated_pages: number | null
  total_words: number | null
}

export interface SerialVolumePreview {
  start: number
  end: number
  name: string | null
  chapter_count: number
  fetched_chapter_count: number
  total_words: number
  estimated_pages: number | null
  is_partial: boolean
}
