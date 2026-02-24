/**
 * Google Sheets Service
 * Handles connection to Google Sheets API and data operations
 * Smart column detection - adapts to any spreadsheet layout
 */

const { google } = require('googleapis');
const axios = require('axios');

class GoogleSheetsService {
    constructor(credentials) {
        this.credentials = credentials;
        this.sheets = null;
        this.auth = null;
    }

    /**
     * Initialize the Google Sheets API client
     */
    async initialize() {
        try {
            // Support multiple auth methods
            if (this.credentials.apiKey) {
                // API Key auth (read-only for public sheets)
                this.auth = this.credentials.apiKey;
            } else if (this.credentials.serviceAccount) {
                // Service Account JSON
                this.auth = new google.auth.GoogleAuth({
                    credentials: this.credentials.serviceAccount,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
            } else if (this.credentials.accessToken) {
                // OAuth access token
                this.auth = new google.auth.OAuth2();
                this.auth.setCredentials({ access_token: this.credentials.accessToken });
            } else {
                throw new Error('No valid credentials provided. Need apiKey, serviceAccount, or accessToken');
            }

            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            return true;
        } catch (err) {
            console.error('Google Sheets initialization error:', err);
            throw err;
        }
    }

    /**
     * Test connection to Google Sheets
     */
    async testConnection(spreadsheetId = null) {
        try {
            if (!this.sheets) await this.initialize();

            // If no spreadsheetId provided, just validate auth works
            if (!spreadsheetId) {
                return { success: true, message: 'Authentication successful' };
            }

            // Try to get spreadsheet info
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'properties.title,properties.locale,sheets.properties.title'
            });

            return {
                success: true,
                message: 'Connected successfully',
                data: {
                    title: response.data.properties.title,
                    sheets: response.data.sheets.map(s => s.properties.title)
                }
            };
        } catch (err) {
            console.error('Google Sheets test connection error:', err);
            return {
                success: false,
                error: this.parseError(err)
            };
        }
    }

    /**
     * Read data from a spreadsheet
     * Returns raw data with detected column mapping
     */
    async readSheet(spreadsheetId, sheetName = null, range = null) {
        try {
            if (!this.sheets) await this.initialize();

            // Build range string
            let readRange = sheetName || 'Sheet1';
            if (range) {
                readRange = `${readRange}!${range}`;
            }

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: readRange,
                valueRenderOption: 'FORMATTED_VALUE'
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Detect columns from headers
            const headers = rows[0];
            const columnMap = this.detectColumns(headers);

            // Parse data rows
            const data = rows.slice(1).map((row, index) => {
                const rowData = { _rowIndex: index + 2 }; // 1-based with header
                headers.forEach((header, colIndex) => {
                    const key = columnMap[header] || this.sanitizeColumnName(header);
                    rowData[key] = row[colIndex] || '';
                });
                return rowData;
            });

            return {
                success: true,
                data,
                columns: columnMap,
                headers,
                totalRows: data.length
            };
        } catch (err) {
            console.error('Read sheet error:', err);
            throw new Error(this.parseError(err));
        }
    }

    /**
     * Smart column detection - identifies common column types
     */
    detectColumns(headers) {
        const columnMap = {};
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());

        // Common patterns for different column types
        const patterns = {
            status: ['status', 'state', 'progress', 'stage', 'done', 'complete'],
            topic: ['topic', 'keyword', 'subject', 'title', 'query', 'theme', 'idea'],
            url: ['url', 'link', 'post url', 'article url', 'wordpress url', 'published url'],
            title: ['title', 'headline', 'post title', 'article title'],
            content: ['content', 'article', 'post', 'body', 'text'],
            notes: ['notes', 'comments', 'remarks', 'feedback'],
            priority: ['priority', 'importance', 'urgency'],
            assignee: ['assignee', 'assigned to', 'owner', 'author'],
            created: ['created', 'date created', 'added', 'timestamp'],
            updated: ['updated', 'last updated', 'modified', 'date modified']
        };

        headers.forEach((header, index) => {
            const lower = lowerHeaders[index];
            let mapped = null;

            // Check against patterns
            for (const [type, keywords] of Object.entries(patterns)) {
                if (keywords.some(k => lower.includes(k))) {
                    mapped = type;
                    break;
                }
            }

            // Default to sanitized header name
            columnMap[header] = mapped || this.sanitizeColumnName(header);
        });

        return columnMap;
    }

    /**
     * Sanitize column name for use as object key
     */
    sanitizeColumnName(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Find rows by status (e.g., PENDING, PROCESSING, DONE)
     */
    findRowsByStatus(data, status, statusColumn = 'status') {
        const statusLower = status.toLowerCase();
        return data.filter(row => {
            const rowStatus = (row[statusColumn] || '').toString().toLowerCase();
            return rowStatus === statusLower || 
                   rowStatus.includes(statusLower);
        });
    }

    /**
     * Find rows that need processing (PENDING or empty status)
     */
    findPendingRows(data, statusColumn = 'status') {
        return data.filter(row => {
            const status = (row[statusColumn] || '').toString().toLowerCase();
            return !status || 
                   status === 'pending' || 
                   status === 'todo' ||
                   status === 'new' ||
                   status === '';
        });
    }

    /**
     * Update cell values in the spreadsheet
     */
    async updateCells(spreadsheetId, updates, sheetName = 'Sheet1') {
        try {
            if (!this.sheets) await this.initialize();

            // Build data for batch update
            const data = updates.map(update => ({
                range: `${sheetName}!${update.cell}`,
                values: [[update.value]]
            }));

            const response = await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data
                }
            });

            return {
                success: true,
                updatedCells: response.data.totalUpdatedCells,
                updates: updates.length
            };
        } catch (err) {
            console.error('Update cells error:', err);
            throw new Error(this.parseError(err));
        }
    }

    /**
     * Update row status and add metadata
     */
    async updateRowStatus(spreadsheetId, rowIndex, status, metadata = {}, sheetName = 'Sheet1', headers = []) {
        try {
            if (!this.sheets) await this.initialize();

            const updates = [];
            const statusColumnIndex = headers.findIndex(h => 
                h.toLowerCase().includes('status')
            );

            if (statusColumnIndex >= 0) {
                const statusCol = this.columnToLetter(statusColumnIndex + 1);
                updates.push({
                    cell: `${statusCol}${rowIndex}`,
                    value: status
                });
            }

            // Add URL if provided and URL column exists
            if (metadata.url) {
                const urlColumnIndex = headers.findIndex(h => 
                    h.toLowerCase().includes('url') || 
                    h.toLowerCase().includes('link')
                );
                if (urlColumnIndex >= 0) {
                    const urlCol = this.columnToLetter(urlColumnIndex + 1);
                    updates.push({
                        cell: `${urlCol}${rowIndex}`,
                        value: metadata.url
                    });
                }
            }

            // Add notes if provided
            if (metadata.notes) {
                const notesColumnIndex = headers.findIndex(h => 
                    h.toLowerCase().includes('notes') || 
                    h.toLowerCase().includes('comments')
                );
                if (notesColumnIndex >= 0) {
                    const notesCol = this.columnToLetter(notesColumnIndex + 1);
                    updates.push({
                        cell: `${notesCol}${rowIndex}`,
                        value: metadata.notes
                    });
                }
            }

            // Add timestamp
            const updatedColumnIndex = headers.findIndex(h => 
                h.toLowerCase().includes('updated') || 
                h.toLowerCase().includes('modified')
            );
            if (updatedColumnIndex >= 0) {
                const updatedCol = this.columnToLetter(updatedColumnIndex + 1);
                updates.push({
                    cell: `${updatedCol}${rowIndex}`,
                    value: new Date().toISOString()
                });
            }

            if (updates.length === 0) {
                return { success: true, message: 'No columns to update' };
            }

            return await this.updateCells(spreadsheetId, updates, sheetName);
        } catch (err) {
            console.error('Update row status error:', err);
            throw new Error(this.parseError(err));
        }
    }

    /**
     * Convert column number to letter (1 = A, 2 = B, etc.)
     */
    columnToLetter(column) {
        let temp, letter = '';
        while (column > 0) {
            temp = (column - 1) % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            column = (column - temp - 1) / 26;
        }
        return letter;
    }

    /**
     * Get column letter for a header name
     */
    getColumnLetter(headers, columnName) {
        const index = headers.findIndex(h => 
            h.toLowerCase().trim() === columnName.toLowerCase().trim()
        );
        return index >= 0 ? this.columnToLetter(index + 1) : null;
    }

    /**
     * Append rows to spreadsheet
     */
    async appendRows(spreadsheetId, rows, sheetName = 'Sheet1') {
        try {
            if (!this.sheets) await this.initialize();

            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: rows
                }
            });

            return {
                success: true,
                updatedRange: response.data.updates.updatedRange,
                updatedRows: response.data.updates.updatedRows
            };
        } catch (err) {
            console.error('Append rows error:', err);
            throw new Error(this.parseError(err));
        }
    }

    /**
     * Create a new spreadsheet
     */
    async createSpreadsheet(title, sheets = ['Topics']) {
        try {
            if (!this.sheets) await this.initialize();

            const response = await this.sheets.spreadsheets.create({
                requestBody: {
                    properties: { title },
                    sheets: sheets.map(name => ({
                        properties: { title: name }
                    }))
                }
            });

            return {
                success: true,
                spreadsheetId: response.data.spreadsheetId,
                spreadsheetUrl: response.data.spreadsheetUrl
            };
        } catch (err) {
            console.error('Create spreadsheet error:', err);
            throw new Error(this.parseError(err));
        }
    }

    /**
     * Parse Google API errors into readable messages
     */
    parseError(err) {
        if (err.code === 403) {
            return 'Access denied. Check your API key has Google Sheets API enabled and permissions are correct.';
        }
        if (err.code === 404) {
            return 'Spreadsheet not found. Check the spreadsheet ID is correct.';
        }
        if (err.code === 400) {
            return 'Invalid request: ' + (err.message || 'Bad request');
        }
        if (err.message?.includes('API key not valid')) {
            return 'Invalid API key. Please check your credentials.';
        }
        return err.message || 'Unknown Google Sheets error';
    }
}

module.exports = GoogleSheetsService;
