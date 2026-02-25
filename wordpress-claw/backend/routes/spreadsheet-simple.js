const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Column mapping from various header formats to our standard columns
const COLUMN_MAPPINGS = {
    'service_url': ['service url', 'service_url', 'serviceurl', 'url', 'service', 'page url', 'page_url', 'link'],
    'main_keyword': ['main keyword', 'main_keyword', 'mainkeyword', 'keyword', 'primary keyword', 'focus keyword', 'topic', 'subject'],
    'cluster_keywords': ['cluster keywords', 'cluster_keywords', 'clusterkeywords', 'secondary keywords', 'keywords', 'related keywords', 'cluster'],
    'gdocs_link': ['gdocs link', 'gdocs_link', 'gdocslink', 'google doc', 'google docs', 'doc link', 'document', 'gdoc'],
    'wp_post_url': ['wp post url', 'wp_post_url', 'wpposturl', 'wordpress url', 'post url', 'published url', 'live url', 'article url'],
    'status': ['status', 'state', 'progress', 'stage'],
    'feature_image': ['feature image', 'feature_image', 'featureimage', 'featured image', 'image', 'hero image', 'thumbnail']
};

/**
 * Normalize header name to our standard column names
 */
function normalizeHeader(header) {
    const lowerHeader = header.toLowerCase().trim().replace(/[^a-z0-9\s_]/g, '');
    
    for (const [standard, variations] of Object.entries(COLUMN_MAPPINGS)) {
        if (variations.includes(lowerHeader)) {
            return standard;
        }
    }
    return lowerHeader.replace(/\s+/g, '_');
}

/**
 * POST /api/spreadsheet-simple/import
 * Import data from pasted TSV/CSV text
 * Accepts: { data: string (tab or comma separated) }
 */
router.post('/import', authenticateToken, async (req, res) => {
    try {
        const { data } = req.body;

        if (!data || !data.trim()) {
            return res.status(400).json({
                success: false,
                error: 'No data provided. Please paste your spreadsheet data.'
            });
        }

        // Parse the data - detect delimiter
        const trimmedData = data.trim();
        const lines = trimmedData.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid data found.'
            });
        }

        // Detect delimiter based on first line
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : 
                         firstLine.includes(',') ? ',' : '\t';

        // Parse headers
        const rawHeaders = firstLine.split(delimiter).map(h => h.trim());
        const headers = rawHeaders.map(normalizeHeader);

        // Parse data rows
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(delimiter).map(v => v.trim());
            const rowObj = {};
            
            rawHeaders.forEach((rawHeader, index) => {
                const normalizedHeader = normalizeHeader(rawHeader);
                rowObj[normalizedHeader] = values[index] || '';
            });

            rows.push(rowObj);
        }

        if (rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No data rows found. Please include at least one row of data.'
            });
        }

        // Delete existing rows for this user (replace mode)
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = ?').run(req.user.id);
        }

        // Insert rows into database
        const insertedRows = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            const serviceUrl = row.service_url || '';
            const mainKeyword = row.main_keyword || '';
            const clusterKeywords = row.cluster_keywords || '';
            const gdocsLink = row.gdocs_link || '';
            const wpPostUrl = row.wp_post_url || '';
            const status = (row.status || 'PENDING').toUpperCase();
            const featureImage = row.feature_image || '';

            let result;
            if (db.isPostgres) {
                result = await db.prepare(`
                    INSERT INTO spreadsheet_rows 
                    (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                `).run(req.user.id, serviceUrl, mainKeyword, clusterKeywords, gdocsLink, wpPostUrl, status, featureImage, i);
            } else {
                result = await db.prepare(`
                    INSERT INTO spreadsheet_rows 
                    (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(req.user.id, serviceUrl, mainKeyword, clusterKeywords, gdocsLink, wpPostUrl, status, featureImage, i);
            }
            
            insertedRows.push({
                id: result.id || result.lastInsertRowid,
                service_url: serviceUrl,
                main_keyword: mainKeyword,
                cluster_keywords: clusterKeywords,
                gdocs_link: gdocsLink,
                wp_post_url: wpPostUrl,
                status: status,
                feature_image: featureImage,
                row_order: i
            });
        }

        res.json({
            success: true,
            message: `Successfully imported ${insertedRows.length} rows`,
            data: {
                totalRows: insertedRows.length,
                rows: insertedRows
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
 * GET /api/spreadsheet-simple/data
 * Get all spreadsheet rows for the current user
 */
router.get('/data', authenticateToken, async (req, res) => {
    try {
        const { status, sortBy = 'row_order', sortOrder = 'asc' } = req.query;

        let query;
        let params;

        const validSortColumns = ['row_order', 'created_at', 'main_keyword', 'status'];
        const orderBy = validSortColumns.includes(sortBy) ? sortBy : 'row_order';
        const orderDir = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        if (status) {
            if (db.isPostgres) {
                query = `
                    SELECT * FROM spreadsheet_rows 
                    WHERE user_id = $1 AND status = $2
                    ORDER BY ${orderBy} ${orderDir}
                `;
                params = [req.user.id, status.toUpperCase()];
            } else {
                query = `
                    SELECT * FROM spreadsheet_rows 
                    WHERE user_id = ? AND status = ?
                    ORDER BY ${orderBy} ${orderDir}
                `;
                params = [req.user.id, status.toUpperCase()];
            }
        } else {
            if (db.isPostgres) {
                query = `
                    SELECT * FROM spreadsheet_rows 
                    WHERE user_id = $1
                    ORDER BY ${orderBy} ${orderDir}
                `;
                params = [req.user.id];
            } else {
                query = `
                    SELECT * FROM spreadsheet_rows 
                    WHERE user_id = ?
                    ORDER BY ${orderBy} ${orderDir}
                `;
                params = [req.user.id];
            }
        }

        const rows = await db.prepare(query).all(...params);

        // Get stats
        let statsQuery;
        if (db.isPostgres) {
            statsQuery = `
                SELECT status, COUNT(*) as count 
                FROM spreadsheet_rows 
                WHERE user_id = $1 
                GROUP BY status
            `;
        } else {
            statsQuery = `
                SELECT status, COUNT(*) as count 
                FROM spreadsheet_rows 
                WHERE user_id = ? 
                GROUP BY status
            `;
        }
        const statsRows = await db.prepare(statsQuery).all(req.user.id);
        
        const stats = {
            total: rows.length,
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
        });

        res.json({
            success: true,
            data: {
                rows,
                stats
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
 * POST /api/spreadsheet-simple/row
 * Add a new row
 */
router.post('/row', authenticateToken, async (req, res) => {
    try {
        const { 
            service_url, 
            main_keyword, 
            cluster_keywords, 
            gdocs_link, 
            wp_post_url, 
            status = 'PENDING',
            feature_image 
        } = req.body;

        // Get max row_order
        let orderQuery;
        if (db.isPostgres) {
            orderQuery = 'SELECT MAX(row_order) as max_order FROM spreadsheet_rows WHERE user_id = $1';
        } else {
            orderQuery = 'SELECT MAX(row_order) as max_order FROM spreadsheet_rows WHERE user_id = ?';
        }
        const orderResult = await db.prepare(orderQuery).get(req.user.id);
        const rowOrder = (orderResult?.max_order || 0) + 1;

        let result;
        if (db.isPostgres) {
            result = await db.prepare(`
                INSERT INTO spreadsheet_rows 
                (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `).run(req.user.id, service_url || '', main_keyword || '', cluster_keywords || '', 
                   gdocs_link || '', wp_post_url || '', status.toUpperCase(), feature_image || '', rowOrder);
        } else {
            result = await db.prepare(`
                INSERT INTO spreadsheet_rows 
                (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, service_url || '', main_keyword || '', cluster_keywords || '', 
                   gdocs_link || '', wp_post_url || '', status.toUpperCase(), feature_image || '', rowOrder);
        }

        res.json({
            success: true,
            message: 'Row added successfully',
            data: {
                id: result.id || result.lastInsertRowid,
                row_order: rowOrder
            }
        });

    } catch (err) {
        console.error('Add row error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to add row: ' + err.message
        });
    }
});

/**
 * PUT /api/spreadsheet-simple/row/:id
 * Update a specific row
 */
router.put('/row/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Verify the row belongs to this user
        let existingRow;
        if (db.isPostgres) {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!existingRow) {
            return res.status(404).json({
                success: false,
                error: 'Row not found'
            });
        }

        // Build update query
        const allowedFields = ['service_url', 'main_keyword', 'cluster_keywords', 'gdocs_link', 
                              'wp_post_url', 'status', 'feature_image', 'row_order'];
        const setClauses = [];
        const params = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (db.isPostgres) {
                    setClauses.push(`${key} = $${paramIndex++}`);
                } else {
                    setClauses.push(`${key} = ?`);
                }
                params.push(key === 'status' ? value.toUpperCase() : value);
            }
        }

        if (setClauses.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        params.push(id, req.user.id);

        let updateQuery;
        if (db.isPostgres) {
            updateQuery = `
                UPDATE spreadsheet_rows 
                SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
            `;
        } else {
            updateQuery = `
                UPDATE spreadsheet_rows 
                SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
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
 * DELETE /api/spreadsheet-simple/row/:id
 * Delete a specific row
 */
router.delete('/row/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        let result;
        if (db.isPostgres) {
            result = await db.prepare('DELETE FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .run(id, req.user.id);
        } else {
            result = await db.prepare('DELETE FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
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
 * DELETE /api/spreadsheet-simple/clear
 * Clear all rows for the current user
 */
router.delete('/clear', authenticateToken, async (req, res) => {
    try {
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = ?').run(req.user.id);
        }

        res.json({
            success: true,
            message: 'All rows cleared'
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
 * POST /api/spreadsheet-simple/export
 * Export data as TSV for copy-paste to Google Sheets
 */
router.post('/export', authenticateToken, async (req, res) => {
    try {
        let query;
        if (db.isPostgres) {
            query = `
                SELECT * FROM spreadsheet_rows 
                WHERE user_id = $1
                ORDER BY row_order ASC
            `;
        } else {
            query = `
                SELECT * FROM spreadsheet_rows 
                WHERE user_id = ?
                ORDER BY row_order ASC
            `;
        }

        const rows = await db.prepare(query).all(req.user.id);

        if (rows.length === 0) {
            return res.json({
                success: true,
                data: {
                    tsv: '',
                    message: 'No data to export'
                }
            });
        }

        // Build TSV
        const headers = ['Service URL', 'Main Keyword', 'Cluster Keywords', 'GDocs Link', 
                        'WP Post URL', 'Status', 'Feature Image'];
        
        const lines = [headers.join('\t')];
        
        for (const row of rows) {
            const values = [
                row.service_url || '',
                row.main_keyword || '',
                row.cluster_keywords || '',
                row.gdocs_link || '',
                row.wp_post_url || '',
                row.status || 'PENDING',
                row.feature_image || ''
            ];
            // Escape values that contain tabs or newlines
            const escapedValues = values.map(v => {
                if (v.includes('\t') || v.includes('\n') || v.includes('"')) {
                    return '"' + v.replace(/"/g, '""') + '"';
                }
                return v;
            });
            lines.push(escapedValues.join('\t'));
        }

        const tsv = lines.join('\n');

        res.json({
            success: true,
            data: {
                tsv,
                rowCount: rows.length
            }
        });

    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export data: ' + err.message
        });
    }
});

/**
 * POST /api/spreadsheet-simple/process/:id
 * Process a single row (generate article)
 */
router.post('/process/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Get the row
        let row;
        if (db.isPostgres) {
            row = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            row = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!row) {
            return res.status(404).json({
                success: false,
                error: 'Row not found'
            });
        }

        const keyword = row.main_keyword;
        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: 'No main keyword found in this row'
            });
        }

        // Update status to PROCESSING
        if (db.isPostgres) {
            await db.prepare('UPDATE spreadsheet_rows SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2')
                .run('PROCESSING', id);
        } else {
            await db.prepare('UPDATE spreadsheet_rows SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run('PROCESSING', id);
        }

        // TODO: Trigger content generation via SummonAgent
        // For now, return success with the keyword that would be processed
        res.json({
            success: true,
            message: `Started processing: "${keyword}"`,
            data: {
                rowId: id,
                keyword,
                status: 'PROCESSING'
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
 * POST /api/spreadsheet-simple/reorder
 * Reorder rows
 */
router.post('/reorder', authenticateToken, async (req, res) => {
    try {
        const { rowIds } = req.body; // Array of row IDs in new order

        if (!Array.isArray(rowIds)) {
            return res.status(400).json({
                success: false,
                error: 'rowIds must be an array'
            });
        }

        for (let i = 0; i < rowIds.length; i++) {
            if (db.isPostgres) {
                await db.prepare('UPDATE spreadsheet_rows SET row_order = $1 WHERE id = $2 AND user_id = $3')
                    .run(i, rowIds[i], req.user.id);
            } else {
                await db.prepare('UPDATE spreadsheet_rows SET row_order = ? WHERE id = ? AND user_id = ?')
                    .run(i, rowIds[i], req.user.id);
            }
        }

        res.json({
            success: true,
            message: 'Rows reordered successfully'
        });

    } catch (err) {
        console.error('Reorder error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to reorder rows: ' + err.message
        });
    }
});

module.exports = router;
