-- AI recommendations: each refresh is a run; its picks are kept until the
-- next run of the same kind finishes. Feedback outlives runs.
CREATE TABLE recommendation_runs (
	id INTEGER PRIMARY KEY,
	kind TEXT NOT NULL, -- read_next | discover
	status TEXT NOT NULL, -- running | done | error
	model TEXT NOT NULL,
	web_search BOOLEAN NOT NULL,
	error TEXT,
	input_tokens INTEGER,
	output_tokens INTEGER,
	web_searches INTEGER,
	cost FLOAT,
	started_at DATETIME NOT NULL,
	finished_at DATETIME
);
CREATE INDEX ix_recommendation_runs_kind ON recommendation_runs (kind, id);

CREATE TABLE recommendations (
	id INTEGER PRIMARY KEY,
	run_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	book_id TEXT, -- read_next: the library book
	title TEXT NOT NULL,
	author TEXT,
	format TEXT NOT NULL, -- book | web_serial
	site TEXT,
	reason TEXT NOT NULL,
	source_url TEXT,
	FOREIGN KEY(run_id) REFERENCES recommendation_runs (id) ON DELETE CASCADE,
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX ix_recommendations_run_id ON recommendations (run_id);

-- One verdict per title (match_key is the normalised title and author).
CREATE TABLE recommendation_feedback (
	id INTEGER PRIMARY KEY,
	match_key TEXT NOT NULL UNIQUE,
	book_id TEXT,
	title TEXT NOT NULL,
	author TEXT,
	format TEXT NOT NULL,
	site TEXT,
	reason TEXT,
	source_url TEXT,
	verdict TEXT NOT NULL, -- not_interested | already_read | not_found | saved
	created_at DATETIME NOT NULL,
	FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);
