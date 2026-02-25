-- Migration: Add spreadsheet_rows table for built-in spreadsheet editor (PostgreSQL)
-- Created: 2026-02-26

-- Create spreadsheet_rows table with specific columns for content workflow
CREATE TABLE IF NOT EXISTS spreadsheet_rows (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_url TEXT,
    main_keyword TEXT,
    cluster_keywords TEXT,
    gdocs_link TEXT,
    wp_post_url TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    feature_image TEXT,
    row_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_user_id ON spreadsheet_rows(user_id);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_status ON spreadsheet_rows(status);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_row_order ON spreadsheet_rows(row_order);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_created_at ON spreadsheet_rows(created_at);

-- Add comment for documentation
COMMENT ON TABLE spreadsheet_rows IS 'Stores rows for the built-in spreadsheet editor with content workflow columns';
