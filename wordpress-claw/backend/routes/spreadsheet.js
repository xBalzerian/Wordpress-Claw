const express = require('express');
const csv = require('csv-parse/sync');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/spreadsheet/import
 * Import data from pasted text or CSV file
 * Accepts: { data: string (tab or comma separated), format: 'auto'|'csv'|'tsv' }
 */
router.post('/import', authenticateToken, async (req, res) => {
    try {
        const { data, format = 'auto' } = req.body;

        if (!data || !data.trim()) {
            return res.status(400).json({
                success: false,
                error: 'No data provided. Please paste your spreadsheet data or upload a CSV file.'
            });
        }

        // Parse the data
        let rows;
        const trimmedData = data.trim();
        
        // Detect format if auto
        let detectedFormat = format;
        if (format === 'auto') {
            // Check if it looks like CSV (has commas) or TSV (has tabs)
            const firstLine = trimmedData.split('\n')[0];
            if (firstLine.includes('\t')) {
                detectedFormat = 'tsv';
            } else if (firstLine.includes(',')) {
                detectedFormat = 'csv';
            } else {
                // Default to TSV for simple paste (common from Google Sheets/Excel)
                detectedFormat = 'tsv';
            }
        }

        try {
            // Parse using csv-parse
            const delimiter = detectedFormat === 'tsv' ? '\t' : ',';
            const records = csv.parse(trimmedData, {
                delimiter,
                skip_empty_lines: true,
                trim: true
            });

            if (!records || records.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid data found. Please check your input format.'
                });
            }

            // First row is headers
            const headers = records[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
            
            // Convert remaining rows to objects
            rows = records.slice(1).map((row, index) => {
                const rowObj = { _rowIndex: index + 2 }; // +2 because header is row 1, data starts at row 2
                headers.forEach((header, i) => {
                    rowObj[header] = row[i] || '';
                });
                return rowObj;
            });

        } catch (parseErr) {
            console.error('Parse error:', parseErr);
            return res.status(400).json({
                success: false,
                error: 'Failed to parse data. Please ensure it is properly formatted as CSV or tab-separated values.'
            });
        }

        if (rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No data rows found. Please include at least one row of data.'
            });
        }

        // Delete existing data for this user (optional - could also append)
        // For now, we replace to avoid duplicates
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_data WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_data WHERE user_id = ?').run(req.user.id);
        }

        // Insert rows into database
        const insertedRows = [];
        for (const row of rows) {
            let result;
            if (db.isPostgres) {
                result = await db.prepare(`
                    INSERT INTO spreadsheet_data (user_id, row_data, status)
                    VALUES ($1, $2, $3)
                    RETURNING id
                `).run(req.user.id, JSON.stringify(row), 'pending');
            } else {
                result = await db.prepare(`
                    INSERT INTO spreadsheet_data (user_id, row_data, status)
                    VALUES (?, ?, ?)
                `).run(req.user.id, JSON.stringify(row), 'pending');
            }
            insertedRows.push({
                id: result.id || result.lastInsertRowid,
                ...row
            });
        }

        res.json({
            success: true,
            message: `Successfully imported ${insertedRows.length} rows`,
            data: {
                totalRows: insertedRows.length,
                headers: Object.keys(rows[0]).filter(k => !k.startsWith('_')),
                preview: insertedRows.slice(0, 10)
            }
        });

    } catch (err) {
        console.error('Import error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to import data: ' + err.message
        });
    }
});

/**
 * POST /api/spreadsheet/import-csv
 * Import data from uploaded CSV file
 * Accepts multipart/form-data with 'file' field
 */
router.post('/import-csv', authenticateToken, async (req, res) => {
    try {
        // For now, we'll handle the file content in the body
        // In production, you'd use multer or similar for file uploads
        const { fileContent } = req.body;

        if (!fileContent) {
            return res.status(400).json({
                success: false,
                error: 'No file content provided'
            });
        }

        // Delegate to the main import endpoint with CSV format
        req.body.data = fileContent;
        req.body.format = 'csv';
        
        // Call the import handler
        return router.handle(req, res, () => {});

    } catch (err) {
        console.error('CSV import error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to import CSV: ' + err.message
        });
    }
});

/**
 * GET /api/spreadsheet/data
 * Get all spreadsheet data for the current user
 * Query params: status (optional filter), limit, offset
 */
router.get('/data', authenticateToken, async (req, res) => {
    try {
        const { status, limit = 100, offset = 0 } = req.query;

        let query;
        let countQuery;
        let params;

        if (status) {
            if (db.isPostgres) {
                query = `
                    SELECT * FROM spreadsheet_data 
                    WHERE user_id = $1 AND status = $2
                    ORDER BY created_at DESC
                    LIMIT $3 OFFSET $4
                `;
                countQuery = `
                    SELECT COUNT(*) as count FROM spreadsheet_data 
                    WHERE user_id = $1 AND status = $2
                `;
                params = [req.user.id, status, parseInt(limit), parseInt(offset)];
            } else {
                query = `
                    SELECT * FROM spreadsheet_data 
                    WHERE user_id = ? AND status = ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                `;
                countQuery = `
                    SELECT COUNT(*) as count FROM spreadsheet_data 
                    WHERE user_id = ? AND status = ?
                `;
                params = [req.user.id, status, parseInt(limit), parseInt(offset)];
            }
        } else {
            if (db.isPostgres) {
                query = `
                    SELECT * FROM spreadsheet_data 
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                `;
                countQuery = `
                    SELECT COUNT(*) as count FROM spreadsheet_data 
                    WHERE user_id = $1
                `;
                params = [req.user.id, parseInt(limit), parseInt(offset)];
            } else {
                query = `
                    SELECT * FROM spreadsheet_data 
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                `;
                countQuery = `
                    SELECT COUNT(*) as count FROM spreadsheet_data 
                    WHERE user_id = ?
                `;
                params = [req.user.id, parseInt(limit), parseInt(offset)];
            }
        }

        const rows = await db.prepare(query).all(...params);
        const countResult = await db.prepare(countQuery).all(...params.slice(0, status ? 2 : 1));
        const totalCount = countResult[0]?.count || 0;

        // Parse JSONB row_data
        const parsedRows = rows.map(row => ({
            id: row.id,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            ...JSON.parse(row.row_data || '{}')
        }));

        // Calculate stats
        let statsQuery;
        if (db.isPostgres) {
            statsQuery = `
                SELECT status, COUNT(*) as count 
                FROM spreadsheet_data 
                WHERE user_id = $1 
                GROUP BY status
            `;
        } else {
            statsQuery = `
                SELECT status, COUNT(*) as count 
                FROM spreadsheet_data 
                WHERE user_id = ? 
                GROUP BY status
            `;
        }
        const statsRows = await db.prepare(statsQuery).all(req.user.id);
        
        const stats = {
            total: totalCount,
            pending: 0,
            processing: 0,
            done: 0,
            error: 0
        };
        
        statsRows.forEach(s => {
            const statusLower = s.status.toLowerCase();
            if (statusLower === 'pending') stats.pending = s.count;
            else if (statusLower === 'processing') stats.processing = s.count;
            else if (['done', 'completed', 'success', 'published'].includes(statusLower)) stats.done = s.count;
            else if (['error', 'failed'].includes(statusLower)) stats.error = s.count;
            else stats[statusLower] = s.count;
        });

        res.json({
            success: true,
            data: {
                rows: parsedRows,
                stats,
                pagination: {
                    total: totalCount,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: totalCount > parseInt(offset) + parsedRows.length
                }
            }
        });

    } catch (err) {
        console.error('Get data error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve data: ' + err.message
        });
    }
});

/**
 * PUT /api/spreadsheet/data/:id
 * Update a specific row's status and/or data
 */
router.put('/data/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rowData } = req.body;

        // First verify the row belongs to this user
        let existingRow;
        if (db.isPostgres) {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_data WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_data WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!existingRow) {
            return res.status(404).json({
                success: false,
                error: 'Row not found'
            });
        }

        // Build update query
        const updates = [];
        const params = [];
        let paramIndex = 1;

        if (status !== undefined) {
            if (db.isPostgres) {
                updates.push(`status = $${paramIndex++}`);
            } else {
                updates.push('status = ?');
            }
            params.push(status);
        }

        if (rowData !== undefined) {
            if (db.isPostgres) {
                updates.push(`row_data = $${paramIndex++}`);
            } else {
                updates.push('row_data = ?');
            }
            params.push(typeof rowData === 'string' ? rowData : JSON.stringify(rowData));
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        // Add updated_at
        if (db.isPostgres) {
            updates.push(`updated_at = CURRENT_TIMESTAMP`);
        } else {
            updates.push('updated_at = CURRENT_TIMESTAMP');
        }

        params.push(id, req.user.id);

        let updateQuery;
        if (db.isPostgres) {
            updateQuery = `
                UPDATE spreadsheet_data 
                SET ${updates.join(', ')}
                WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
            `;
        } else {
            updateQuery = `
                UPDATE spreadsheet_data 
                SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `;
        }

        await db.prepare(updateQuery).run(...params);

        res.json({
            success: true,
            message: 'Row updated successfully'
        });

    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update row: ' + err.message
        });
    }
});

/**
 * DELETE /api/spreadsheet/data/:id
 * Delete a specific row
 */
router.delete('/data/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        let result;
        if (db.isPostgres) {
            result = await db.prepare('DELETE FROM spreadsheet_data WHERE id = $1 AND user_id = $2')
                .run(id, req.user.id);
        } else {
            result = await db.prepare('DELETE FROM spreadsheet_data WHERE id = ? AND user_id = ?')
                .run(id, req.user.id);
        }

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Row not found'
            });
        }

        res.json({
            success: true,
            message: 'Row deleted successfully'
        });

    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete row: ' + err.message
        });
    }
});

/**
 * DELETE /api/spreadsheet/data
 * Clear all data for the current user
 */
router.delete('/data', authenticateToken, async (req, res) => {
    try {
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_data WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_data WHERE user_id = ?').run(req.user.id);
        }

        res.json({
            success: true,
            message: 'All spreadsheet data cleared'
        });

    } catch (err) {
        console.error('Clear error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to clear data: ' + err.message
        });
    }
});

/**
 * POST /api/spreadsheet/process/:id
 * Process a single row (generate article from topic/keyword)
 */
router.post('/process/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { options = {} } = req.body;

        // Get the row
        let row;
        if (db.isPostgres) {
            row = await db.prepare('SELECT * FROM spreadsheet_data WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            row = await db.prepare('SELECT * FROM spreadsheet_data WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!row) {
            return res.status(404).json({
                success: false,
                error: 'Row not found'
            });
        }

        const rowData = JSON.parse(row.row_data || '{}');
        
        // Extract topic/keyword from common column names
        const topic = rowData.topic || rowData.keyword || rowData.title || rowData.subject || '';
        
        if (!topic) {
            return res.status(400).json({
                success: false,
                error: 'No topic or keyword found in this row'
            });
        }

        // Update status to processing
        if (db.isPostgres) {
            await db.prepare('UPDATE spreadsheet_data SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2')
                .run('processing', id);
        } else {
            await db.prepare('UPDATE spreadsheet_data SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run('processing', id);
        }

        // TODO: Trigger content generation via SummonAgent
        // For now, return success with the topic that would be processed
        res.json({
            success: true,
            message: `Started processing: "${topic}"`,
            data: {
                rowId: id,
                topic,
                status: 'processing'
            }
        });

    } catch (err) {
        console.error('Process error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to process row: ' + err.message
        });
    }
});

/**
 * POST /api/spreadsheet/process-all
 * Process all pending rows
 */
router.post('/process-all', authenticateToken, async (req, res) => {
    try {
        // Get all pending rows
        let pendingRows;
        if (db.isPostgres) {
            pendingRows = await db.prepare(`
                SELECT * FROM spreadsheet_data 
                WHERE user_id = $1 AND status = 'pending'
                ORDER BY created_at ASC
            `).all(req.user.id);
        } else {
            pendingRows = await db.prepare(`
                SELECT * FROM spreadsheet_data 
                WHERE user_id = ? AND status = 'pending'
                ORDER BY created_at ASC
            `).all(req.user.id);
        }

        if (pendingRows.length === 0) {
            return res.json({
                success: true,
                message: 'No pending rows to process',
                data: { processed: 0 }
            });
        }

        // Update all to processing
        const rowIds = pendingRows.map(r => r.id);
        
        if (db.isPostgres) {
            await db.prepare(`
                UPDATE spreadsheet_data 
                SET status = 'processing', updated_at = CURRENT_TIMESTAMP
                WHERE id = ANY($1::int[])
            `).run(rowIds);
        } else {
            // SQLite doesn't support ANY, so we do individual updates
            for (const id of rowIds) {
                await db.prepare('UPDATE spreadsheet_data SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run('processing', id);
            }
        }

        res.json({
            success: true,
            message: `Started processing ${pendingRows.length} rows`,
            data: { 
                processed: pendingRows.length,
                topics: pendingRows.map(r => {
                    const data = JSON.parse(r.row_data || '{}');
                    return data.topic || data.keyword || data.title || 'Untitled';
                })
            }
        });

    } catch (err) {
        console.error('Process all error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to process rows: ' + err.message
        });
    }
});

module.exports = router;
