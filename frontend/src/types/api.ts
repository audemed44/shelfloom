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
  hasGenre: boolean | null
  hasTag: boolean | null
  hasAuthor: boolean | null
  hasSeries: boolean | null
  minRating: number | null
  hasRating: boolean | null
  hasReview: boolean | null
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
  status: 'unread' | 'reading' | 'completed' | 'dnf'
  rating: number | null
  has_review: boolean
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
  cover_path: string | null
  created_at: string
  updated_at: string
  reading_progress: number | null // 0–100, null = unread
  last_read: string | null
  series_id: number | null
  series_name: string | null
  series_sequence: number | null
  tags: Tag[]
}

export interface BookDetail extends Book {
  review: string | null
  review_updated_at: string | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  pages: number
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
  first_book_cover_path: string | null
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
  has_genre: boolean | null
  has_tag: boolean | null
  has_author: boolean | null
  has_series: boolean | null
  min_rating: number | null
  has_rating: boolean | null
  has_review: boolean | null
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
  cover_book_path: string | null
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
  live_chapter_count: number
  stubbed_chapter_count: number
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  series_id: number | null
}

export interface SerialDashboardEntry {
  id: number
  title: string | null
  author: string | null
  cover_path: string | null
  status: string
  total_chapters: number
  live_chapter_count: number
  stubbed_chapter_count: number
  fetched_count: number
  new_chapter_count: number
  latest_chapter_title: string | null
  latest_chapter_date: string | null
  last_checked_at: string | null
  fetch_state: string
}

export interface SerialChapter {
  id: number
  serial_id: number
  chapter_number: number
  title: string | null
  source_url: string
  is_stubbed: boolean
  stubbed_at: string | null
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

export interface PendingChapterFetchResponse {
  status: string
  new_chapters: number
  pending_count: number
  job: ChapterFetchJobResponse | null
}

export interface PendingChapterBatchStatusResponse {
  state: string
  total_serials: number
  processed_serials: number
  current_serial_id: number | null
  started: number
  already_running: number
  noop: number
  failed: number
  new_chapters: number
  started_at: string | null
  finished_at: string | null
  error: string | null
}

export interface SerialVolume {
  id: number
  serial_id: number
  book_id: string | null
  volume_number: number
  /** "ebook" = a linked library book (e.g. the published edition), never generated */
  kind: 'generated' | 'ebook'
  name: string | null
  cover_path: string | null
  /** Always set for generated volumes; optional for linked ebooks */
  chapter_start: number | null
  chapter_end: number | null
  generated_at: string | null
  is_stale: boolean
  chapter_count: number
  fetched_chapter_count: number
  is_partial: boolean
  stubbed_missing_count: number
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
  stubbed_missing_count: number
}

export interface ZLibraryStatus {
  enabled: boolean
  domain: string
  downloads_today: number | null
  downloads_limit: number | null
  error: string | null
}

export interface ZLibraryResult {
  id: string
  hash: string
  title: string
  author: string | null
  publisher: string | null
  year: number | null
  language: string | null
  pages: number | null
  series: string | null
  extension: string
  size: string | null
  isbns: string[]
  cover_url: string | null
  description: string | null
  in_library_book_id: string | null
}

export interface ZLibrarySearchResponse {
  results: ZLibraryResult[]
  page: number
  has_more: boolean
}

export interface ZLibraryAddResponse {
  book: BookDetail
  already_in_library: boolean
  series: string | null
  series_sequence: string | null
}

export interface ZLibraryDomains {
  selected: string
  default: string
  enabled: boolean
  domains: { domain: string; source: 'official' | 'zlibrary' | 'custom' }[]
  fetched_from: string | null
  fetched_at: number | null
}

export interface ZLibraryDomainCheck {
  domain: string
  ok: boolean
  ms: number
  error: string | null
}

// ── AI recommendations ────────────────────────────────────────────────────

export type RecommendationKind = 'read_next' | 'discover'
export type DiscoverKinds = 'both' | 'books' | 'web_serials'
export type RecommendationVerdict =
  | 'not_interested'
  | 'already_read'
  | 'not_found'
  | 'saved'

export interface RecommendationSettings {
  model: string
  web_search: boolean
  share_notes: boolean
  weekly: boolean
  discover_kinds: DiscoverKinds
}

export interface RecommendationRun {
  id: number
  status: 'running' | 'done' | 'error'
  model: string
  web_search: boolean
  error: string | null
  input_tokens: number | null
  output_tokens: number | null
  web_searches: number | null
  cost: number | null
  started_at: string
  finished_at: string | null
}

export interface Recommendation {
  id: number
  book: {
    id: string
    cover_path: string | null
    series_name: string | null
    series_sequence: number | null
    progress: number | null
  } | null
  title: string
  author: string | null
  format: 'book' | 'web_serial'
  site: string | null
  reason: string
  source_url: string | null
  feedback: RecommendationVerdict | null
}

export interface RecommendationList {
  run: RecommendationRun | null
  running: boolean
  items: Recommendation[]
}

export interface SavedRecommendation {
  id: number
  book_id: string | null
  title: string
  author: string | null
  format: 'book' | 'web_serial'
  site: string | null
  reason: string | null
  source_url: string | null
  verdict: RecommendationVerdict
  created_at: string
}

export interface RecommendationsResponse {
  enabled: boolean
  settings: RecommendationSettings
  read_next: RecommendationList
  discover: RecommendationList
  saved: SavedRecommendation[]
}

export interface RecommendationSettingsResponse {
  enabled: boolean
  settings: RecommendationSettings
  default_model: string
}

export interface OpenRouterModel {
  id: string
  name: string
  context_length: number
  input_price: number
  output_price: number
  structured_outputs: boolean
  tools: boolean
}

export interface RecommendationPrompt {
  kind: RecommendationKind
  model: string
  web_search: boolean
  system: string
  user: string
  schema: unknown
  tools: unknown[] | null
  approx_tokens: number
}
