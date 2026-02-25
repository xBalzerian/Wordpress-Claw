-- Migration: Add spreadsheet_data table for simple data import
-- Created: 2026-02-26

-- Create spreadsheet_data table
CREATE TABLE IF NOT EXISTS spreadsheet_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    row_data JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_spreadsheet_data_user_id ON spreadsheet_data(user_id);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_data_status ON spreadsheet_data(status);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_data_created_at ON spreadsheet_data(created_at);

-- Add comment for documentation
COMMENT ON TABLE spreadsheet_data IS 'Stores imported spreadsheet data from copy-paste or CSV upload';
