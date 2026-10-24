-- What Shelfloom last wrote into each EPUB's OPF (series, genres, tags), as
-- a fingerprint, so a file is only rewritten when that changes.
CREATE TABLE epub_metadata (
	book_id TEXT PRIMARY KEY NOT NULL REFERENCES books (id) ON DELETE CASCADE,
	fingerprint TEXT NOT NULL
);
