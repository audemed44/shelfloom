-- The schema at Alembic revision e7b2c9d41a05, the last one the Python backend
-- applied. alembic_version is kept so an older release still opens the file.
CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL,
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
CREATE TABLE kosync_users (
	username TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	PRIMARY KEY (username)
);
CREATE TABLE series (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	parent_id INTEGER,
	description TEXT,
	cover_path TEXT,
	sort_order INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(parent_id) REFERENCES series (id) ON DELETE SET NULL
);
CREATE TABLE shelves (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	path TEXT NOT NULL,
	is_default BOOLEAN NOT NULL,
	is_sync_target BOOLEAN NOT NULL,
	device_name TEXT,
	koreader_stats_db_path TEXT,
	auto_organize BOOLEAN NOT NULL,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);
CREATE TABLE tags (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);
CREATE TABLE reading_orders (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	series_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(series_id) REFERENCES series (id) ON DELETE CASCADE
);
CREATE TABLE shelf_templates (
	shelf_id INTEGER NOT NULL,
	template TEXT NOT NULL,
	seq_pad INTEGER NOT NULL,
	PRIMARY KEY (shelf_id),
	FOREIGN KEY(shelf_id) REFERENCES shelves (id) ON DELETE CASCADE
);
CREATE TABLE book_hashes (
	id INTEGER NOT NULL,
	book_id TEXT NOT NULL,
	hash_sha TEXT NOT NULL,
	hash_md5 TEXT NOT NULL,
	page_count INTEGER,
	recorded_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, hash_md5_ko TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE TABLE book_series (
	book_id TEXT NOT NULL,
	series_id INTEGER NOT NULL,
	sequence FLOAT,
	PRIMARY KEY (book_id, series_id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE,
	FOREIGN KEY(series_id) REFERENCES series (id) ON DELETE CASCADE
);
CREATE TABLE book_tags (
	book_id TEXT NOT NULL,
	tag_id INTEGER NOT NULL,
	PRIMARY KEY (book_id, tag_id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE,
	FOREIGN KEY(tag_id) REFERENCES tags (id) ON DELETE CASCADE
);
CREATE TABLE highlights (
	id INTEGER NOT NULL,
	book_id TEXT NOT NULL,
	text TEXT NOT NULL,
	note TEXT,
	chapter TEXT,
	page INTEGER,
	created DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE TABLE reading_order_entries (
	id INTEGER NOT NULL,
	reading_order_id INTEGER NOT NULL,
	book_id TEXT NOT NULL,
	position INTEGER NOT NULL,
	note TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE,
	FOREIGN KEY(reading_order_id) REFERENCES reading_orders (id) ON DELETE CASCADE
);
CREATE TABLE reading_progress (
	id INTEGER NOT NULL,
	book_id TEXT NOT NULL,
	progress FLOAT,
	device TEXT,
	chapter TEXT,
	position TEXT,
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE TABLE rename_logs (
	id INTEGER NOT NULL,
	book_id TEXT,
	shelf_id INTEGER,
	template TEXT NOT NULL,
	old_path TEXT NOT NULL,
	new_path TEXT NOT NULL,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE SET NULL,
	FOREIGN KEY(shelf_id) REFERENCES shelves (id) ON DELETE SET NULL
);
CREATE TABLE unmatched_koreader_entries (
	id INTEGER NOT NULL,
	title TEXT NOT NULL,
	author TEXT,
	source TEXT NOT NULL,
	source_path TEXT,
	session_count INTEGER NOT NULL,
	total_duration_seconds INTEGER NOT NULL,
	dismissed BOOLEAN NOT NULL,
	linked_book_id TEXT,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(linked_book_id) REFERENCES books (id) ON DELETE SET NULL
);
CREATE TABLE unmatched_sessions (
	id INTEGER NOT NULL,
	unmatched_entry_id INTEGER NOT NULL,
	start_time DATETIME,
	duration INTEGER,
	pages_read INTEGER,
	source_key TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(unmatched_entry_id) REFERENCES unmatched_koreader_entries (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "reading_sessions" (
	id INTEGER NOT NULL,
	book_id TEXT NOT NULL,
	start_time DATETIME,
	duration INTEGER,
	pages_read INTEGER,
	device TEXT,
	source TEXT NOT NULL,
	source_key TEXT,
	dismissed BOOLEAN NOT NULL,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY (id),
	UNIQUE (source_key),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE TABLE web_serials (
	id INTEGER NOT NULL,
	url TEXT NOT NULL,
	source TEXT NOT NULL,
	title TEXT,
	author TEXT,
	description TEXT,
	cover_path TEXT,
	cover_url TEXT,
	status TEXT NOT NULL,
	total_chapters INTEGER NOT NULL,
	last_checked_at DATETIME,
	last_error TEXT,
	source_metadata TEXT,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	series_id INTEGER, last_viewed_at DATETIME, live_chapter_count INTEGER DEFAULT '0' NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(series_id) REFERENCES series (id) ON DELETE SET NULL,
	UNIQUE (url)
);
CREATE TABLE genres (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);
CREATE TABLE book_genres (
	book_id TEXT NOT NULL,
	genre_id INTEGER NOT NULL,
	PRIMARY KEY (book_id, genre_id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE,
	FOREIGN KEY(genre_id) REFERENCES genres (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "books" (
	id TEXT NOT NULL,
	title TEXT NOT NULL,
	author TEXT,
	isbn TEXT,
	format TEXT NOT NULL,
	file_path TEXT NOT NULL,
	shelf_id INTEGER NOT NULL,
	file_hash TEXT,
	file_hash_md5 TEXT,
	epub_uid TEXT,
	file_size INTEGER,
	cover_path TEXT,
	publisher TEXT,
	language TEXT,
	description TEXT,
	page_count INTEGER,
	date_added DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	date_published TEXT,
	metadata_raw TEXT,
	file_hash_md5_ko TEXT, rating FLOAT, review TEXT, review_updated_at DATETIME, reading_state TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(shelf_id) REFERENCES shelves (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ix_books_shelf_id_file_path ON books (shelf_id, file_path);
CREATE TABLE lenses (
	id INTEGER NOT NULL,
	name TEXT NOT NULL,
	filter_state TEXT NOT NULL,
	sort_order INTEGER NOT NULL,
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS "serial_chapters" (
	id INTEGER NOT NULL,
	serial_id INTEGER NOT NULL,
	chapter_number INTEGER NOT NULL,
	title TEXT,
	source_url TEXT NOT NULL,
	publish_date DATETIME,
	content TEXT,
	word_count INTEGER,
	fetched_at DATETIME,
	source_key TEXT NOT NULL,
	is_stubbed BOOLEAN DEFAULT 0 NOT NULL,
	stubbed_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(serial_id) REFERENCES web_serials (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ix_serial_chapters_serial_id_chapter_number ON serial_chapters (serial_id, chapter_number);
CREATE UNIQUE INDEX ix_serial_chapters_serial_id_source_key ON serial_chapters (serial_id, source_key);
CREATE TABLE IF NOT EXISTS "serial_volumes" (
	id INTEGER NOT NULL,
	serial_id INTEGER NOT NULL,
	book_id TEXT,
	volume_number INTEGER NOT NULL,
	name TEXT,
	cover_path TEXT,
	chapter_start INTEGER,
	chapter_end INTEGER,
	generated_at DATETIME,
	is_stale BOOLEAN NOT NULL,
	kind TEXT DEFAULT 'generated' NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE SET NULL,
	FOREIGN KEY(serial_id) REFERENCES web_serials (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ix_serial_volumes_serial_id_volume_number ON serial_volumes (serial_id, volume_number);
CREATE TABLE IF NOT EXISTS "kosync_progress" (
	id INTEGER NOT NULL,
	username TEXT NOT NULL,
	document TEXT NOT NULL,
	progress TEXT NOT NULL,
	percentage FLOAT NOT NULL,
	device TEXT NOT NULL,
	timestamp INTEGER NOT NULL,
	device_id TEXT,
	book_id TEXT,
	locator TEXT,
	PRIMARY KEY (id),
	CONSTRAINT fk_kosync_progress_book_id FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE SET NULL
);
CREATE INDEX ix_kosync_progress_username ON kosync_progress (username);
CREATE INDEX ix_kosync_progress_book_id ON kosync_progress (book_id);
CREATE TABLE reading_goals (
	year INTEGER NOT NULL,
	books INTEGER NOT NULL,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (year)
);
INSERT INTO alembic_version (version_num) VALUES ('e7b2c9d41a05');
