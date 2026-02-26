-- Add content_queue table for PostgreSQL
-- This replaces the spreadsheet-based approach

CREATE TABLE IF NOT EXISTS content_queue (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    service_url TEXT,
    main_keyword TEXT NOT NULL,
    cluster_keywords TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
    wp_post_url TEXT,
    feature_image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_content_queue_user_id ON content_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_queue_created ON content_queue(created_at);
