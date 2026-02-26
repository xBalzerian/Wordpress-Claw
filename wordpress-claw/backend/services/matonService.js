/**
 * Maton Service - Browser automation for Google Sheets
 * Uses Maton AI Agent Toolkit for API-based Google Sheets integration
 */

const { MatonAgentToolkit } = require('@maton/agent-toolkit/ai-sdk');
const db = require('../database/db');

class MatonService {
    constructor() {
        this.toolkit = null;
        this.apiKey = process.env.MATON_API_KEY || null;
        this.connections = new Map(); // Store user connections
    }

    /**
     * Initialize Maton with API key
     */
    async initialize() {
        if (!this.apiKey) {
            return {
                success: false,
                error: 'MATON_API_KEY not configured. Please set the environment variable.'
            };
        }

        try {
            this.toolkit = new MatonAgentToolkit({
                apiKey: this.apiKey
            });

            return {
                success: true,
                message: 'Maton initialized successfully'
            };
        } catch (error) {
            console.error('Maton initialization error:', error);
            return {
                success: false,
                error: error.message || 'Failed to initialize Maton'
            };
        }
    }

    /**
     * Check if Maton is properly configured
     */
    isConfigured() {
        return !!this.apiKey && !!this.toolkit;
    }

    /**
     * Start connection to Google Sheets
     * Returns a redirect URL for OAuth
     */
    async connectToGoogleSheets(userId) {
        if (!this.isConfigured()) {
            const init = await this.initialize();
            if (!init.success) return init;
        }

        try {
            // Start connection to Google Sheets
            const result = await this.toolkit.google_sheet_start_connection({});
            const parsed = JSON.parse(result);

            if (parsed.connection_id && parsed.redirect_url) {
                // Store pending connection
                this.connections.set(userId, {
                    connectionId: parsed.connection_id,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                });

                // Save to database
                await this.saveConnection(userId, {
                    connectionId: parsed.connection_id,
                    status: 'pending',
                    connectedAt: new Date().toISOString()
                });

                return {
                    success: true,
                    message: parsed.instruction || 'Please open the redirect URL to complete OAuth',
                    data: {
                        connectionId: parsed.connection_id,
                        redirectUrl: parsed.redirect_url,
                        status: 'pending'
                    }
                };
            }

            return {
                success: false,
                error: 'Failed to start connection'
            };
        } catch (error) {
            console.error('Connect to Google Sheets error:', error);
            return {
                success: false,
                error: error.message || 'Failed to connect to Google Sheets'
            };
        }
    }

    /**
     * Check if user has an active connection
     */
    async checkConnection(userId) {
        if (!this.isConfigured()) {
            return {
                success: false,
                isConnected: false,
                error: 'Maton not initialized'
            };
        }

        try {
            const result = await this.toolkit.google_sheet_check_connection({});
            const isConnected = result === true || result === 'true';

            // Update connection status
            if (isConnected) {
                const conn = this.connections.get(userId);
                if (conn) {
                    conn.status = 'active';
                    await this.saveConnection(userId, {
                        connectionId: conn.connectionId,
                        status: 'active',
                        connectedAt: new Date().toISOString()
                    });
                }
            }

            return {
                success: true,
                isConnected
            };
        } catch (error) {
            console.error('Check connection error:', error);
            return {
                success: false,
                isConnected: false,
                error: error.message
            };
        }
    }

    /**
     * Get values from a Google Sheet
     */
    async getSheetValues(spreadsheetId, worksheetId, range) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Maton not initialized'
            };
        }

        try {
            const result = await this.toolkit.google_sheet_get_values_in_range({
                spreadsheet_id: spreadsheetId,
                worksheet_id: worksheetId,
                range: range
            });

            const parsed = JSON.parse(result);

            return {
                success: true,
                data: parsed
            };
        } catch (error) {
            console.error('Get sheet values error:', error);
            return {
                success: false,
                error: error.message || 'Failed to get sheet values'
            };
        }
    }

    /**
     * Read data from a spreadsheet using the agent
     */
    async readSheet(spreadsheetId, options = {}) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Maton not initialized'
            };
        }

        try {
            // First, list worksheets to get the worksheet ID
            const listResult = await this.toolkit.google_sheet_list_worksheets({
                spreadsheet_id: spreadsheetId
            });
            const worksheets = JSON.parse(listResult);

            if (!worksheets || worksheets.length === 0) {
                return {
                    success: false,
                    error: 'No worksheets found in spreadsheet'
                };
            }

            const worksheetId = options.worksheetId || worksheets[0].id;

            // Get values from the worksheet
            const range = options.range || 'A1:Z1000';
            const valuesResult = await this.toolkit.google_sheet_get_values_in_range({
                spreadsheet_id: spreadsheetId,
                worksheet_id: worksheetId,
                range: range
            });

            const values = JSON.parse(valuesResult);

            // Parse headers and rows
            const headers = values[0] || [];
            const rows = values.slice(1).map((row, index) => {
                const obj = { _rowIndex: index + 2 };
                headers.forEach((header, colIndex) => {
                    const key = this.sanitizeColumnName(header);
                    obj[key] = row[colIndex] || '';
                });
                return obj;
            });

            return {
                success: true,
                data: {
                    headers,
                    rows,
                    totalRows: rows.length,
                    worksheets: worksheets.map(w => ({ id: w.id, title: w.title }))
                }
            };
        } catch (error) {
            console.error('Read sheet error:', error);
            return {
                success: false,
                error: error.message || 'Failed to read sheet'
            };
        }
    }

    /**
     * Write data to a Google Sheet
     */
    async writeSheet(spreadsheetId, data, options = {}) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Maton not initialized'
            };
        }

        try {
            // Get worksheet ID
            const listResult = await this.toolkit.google_sheet_list_worksheets({
                spreadsheet_id: spreadsheetId
            });
            const worksheets = JSON.parse(listResult);

            if (!worksheets || worksheets.length === 0) {
                return {
                    success: false,
                    error: 'No worksheets found'
                };
            }

            const worksheetId = options.worksheetId || worksheets[0].id;

            // Add multiple rows
            const result = await this.toolkit.google_sheet_add_multiple_rows({
                spreadsheet_id: spreadsheetId,
                worksheet_id: worksheetId,
                values: data
            });

            return {
                success: true,
                message: 'Data written successfully',
                data: JSON.parse(result)
            };
        } catch (error) {
            console.error('Write sheet error:', error);
            return {
                success: false,
                error: error.message || 'Failed to write to sheet'
            };
        }
    }

    /**
     * Update specific cells
     */
    async updateCells(spreadsheetId, updates, options = {}) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Maton not initialized'
            };
        }

        try {
            // Get worksheet ID
            const listResult = await this.toolkit.google_sheet_list_worksheets({
                spreadsheet_id: spreadsheetId
            });
            const worksheets = JSON.parse(listResult);

            if (!worksheets || worksheets.length === 0) {
                return {
                    success: false,
                    error: 'No worksheets found'
                };
            }

            const worksheetId = options.worksheetId || worksheets[0].id;

            // Update each cell
            for (const update of updates) {
                await this.toolkit.google_sheet_update_cell({
                    spreadsheet_id: spreadsheetId,
                    worksheet_id: worksheetId,
                    cell: update.cell,
                    value: String(update.value)
                });
            }

            return {
                success: true,
                message: `${updates.length} cells updated`
            };
        } catch (error) {
            console.error('Update cells error:', error);
            return {
                success: false,
                error: error.message || 'Failed to update cells'
            };
        }
    }

    /**
     * Sync content queue with Google Sheet
     */
    async syncWithContentQueue(userId, spreadsheetId, options = {}) {
        const readResult = await this.readSheet(spreadsheetId, options);
        
        if (!readResult.success) {
            return readResult;
        }

        const { headers, rows } = readResult.data;
        const imported = [];
        const errors = [];

        // Map common column names
        const columnMap = this.detectColumns(headers);

        for (const row of rows) {
            try {
                const mainKeyword = row[columnMap['main_keyword']] || row['main_keyword'];
                
                if (!mainKeyword || String(mainKeyword).trim() === '') {
                    continue;
                }

                const serviceUrl = row[columnMap['service_url']] || row['service_url'] || null;
                const clusterKeywords = row[columnMap['cluster_keywords']] || row['cluster_keywords'] || null;
                const status = row[columnMap['status']] || row['status'] || 'pending';

                // Insert into database
                const result = await db.prepare(`
                    INSERT INTO content_queue (user_id, service_url, main_keyword, cluster_keywords, status)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    userId,
                    serviceUrl,
                    mainKeyword.trim(),
                    clusterKeywords,
                    ['pending', 'processing', 'done', 'error'].includes(status) ? status : 'pending'
                );

                imported.push({
                    id: result.lastInsertRowid,
                    main_keyword: mainKeyword,
                    status
                });
            } catch (err) {
                errors.push({
                    row: row._rowIndex,
                    error: err.message
                });
            }
        }

        return {
            success: true,
            message: `Imported ${imported.length} items from Google Sheet`,
            data: {
                imported,
                errors,
                totalRows: rows.length
            }
        };
    }

    /**
     * Export content queue to Google Sheet
     */
    async exportContentQueue(userId, spreadsheetId, options = {}) {
        try {
            // Get content queue items
            const items = await db.prepare(`
                SELECT id, service_url, main_keyword, cluster_keywords, status, 
                       wp_post_url, feature_image, created_at, updated_at
                FROM content_queue 
                WHERE user_id = ?
                ORDER BY created_at DESC
            `).all(userId);

            if (items.length === 0) {
                return {
                    success: false,
                    error: 'No items to export'
                };
            }

            // Prepare data for export
            const headers = ['ID', 'Main Keyword', 'Service URL', 'Cluster Keywords', 'Status', 'WP Post URL', 'Feature Image', 'Created At', 'Updated At'];
            const rows = items.map(item => [
                String(item.id),
                item.main_keyword || '',
                item.service_url || '',
                item.cluster_keywords || '',
                item.status || 'pending',
                item.wp_post_url || '',
                item.feature_image || '',
                item.created_at || '',
                item.updated_at || ''
            ]);

            // Write to sheet
            const writeResult = await this.writeSheet(spreadsheetId, [headers, ...rows], options);
            
            return {
                success: true,
                message: `Exported ${items.length} items to Google Sheet`,
                data: {
                    exportedCount: items.length
                }
            };
        } catch (error) {
            console.error('Export content queue error:', error);
            return {
                success: false,
                error: error.message || 'Failed to export content queue'
            };
        }
    }

    /**
     * Extract spreadsheet ID from URL
     */
    static extractSpreadsheetId(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
            /^([a-zA-Z0-9-_]{40,})$/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Save connection info to database
     */
    async saveConnection(userId, connectionData) {
        try {
            const existing = await db.prepare(`
                SELECT id FROM user_connections 
                WHERE user_id = ? AND type = 'google_sheets_maton'
            `).get(userId);

            if (existing) {
                await db.prepare(`
                    UPDATE user_connections 
                    SET credentials = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(JSON.stringify(connectionData), existing.id);
            } else {
                await db.prepare(`
                    INSERT INTO user_connections (user_id, type, name, credentials, status)
                    VALUES (?, 'google_sheets_maton', 'Google Sheets (Maton)', ?, ?)
                `).run(userId, JSON.stringify(connectionData), connectionData.status);
            }
        } catch (error) {
            console.error('Save connection error:', error);
        }
    }

    /**
     * Get saved connection for user
     */
    async getConnection(userId) {
        try {
            const connection = await db.prepare(`
                SELECT * FROM user_connections 
                WHERE user_id = ? AND type = 'google_sheets_maton'
            `).get(userId);

            if (connection) {
                return {
                    ...connection,
                    credentials: JSON.parse(connection.credentials || '{}')
                };
            }
            return null;
        } catch (error) {
            console.error('Get connection error:', error);
            return null;
        }
    }

    /**
     * Helper: Sanitize column name
     */
    sanitizeColumnName(name) {
        if (!name) return '';
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Helper: Detect column types
     */
    detectColumns(headers) {
        const columnMap = {};
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());

        const patterns = {
            main_keyword: ['main keyword', 'keyword', 'main_keyword', 'topic', 'title', 'query'],
            service_url: ['service url', 'service_url', 'url', 'serviceurl', 'link'],
            cluster_keywords: ['cluster keywords', 'cluster_keywords', 'cluster', 'keywords', 'tags'],
            status: ['status', 'state', 'progress']
        };

        headers.forEach((header, index) => {
            const lower = lowerHeaders[index];
            for (const [standard, variations] of Object.entries(patterns)) {
                if (variations.includes(lower)) {
                    columnMap[standard] = header;
                    break;
                }
            }
        });

        return columnMap;
    }
}

module.exports = new MatonService();
