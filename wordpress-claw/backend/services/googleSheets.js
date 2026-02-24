/**
 * Google Sheets Service
 * Simplified URL-based access - no API keys needed for public sheets
 */

const axios = require('axios');

class GoogleSheetsService {
    constructor(credentials = {}) {
        this.credentials = credentials;
        this.spreadsheetId = credentials.spreadsheetId || null;
    }

    /**
     * Extract spreadsheet ID from various Google Sheets URL formats
     */
    static extractSpreadsheetId(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        // Handle different URL formats:
        // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
        // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0
        // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID
        // SPREADSHEET_ID (just the ID itself)

        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
            /^([a-zA-Z0-9-_]{40,})$/ // Just the ID (44 chars typically)
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
     * Build the Google Sheets CSV export URL
     */
    static getCsvUrl(spreadsheetId, sheetName = null) {
        const gid = sheetName ? `&gid=${sheetName}` : '';
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid}`;
    }

    /**
     * Test connection to a Google Sheet
     * Uses the public CSV export endpoint
     */
    async testConnection(spreadsheetId = null) {
        const id = spreadsheetId || this.spreadsheetId;
        
        if (!id) {
            return {
                success: false,
                error: 'No spreadsheet ID provided'
            };
        }

        try {
            // Try to fetch the sheet as CSV (public access)
            const csvUrl = GoogleSheetsService.getCsvUrl(id);
            const response = await axios.get(csvUrl, {
                timeout: 10000,
                maxRedirects: 5
            });

            if (response.status === 200 && response.data) {
                // Parse first line to get headers
                const lines = response.data.split('\n').filter(line => line.trim());
                const headers = lines[0] ? this.parseCsvLine(lines[0]) : [];

                return {
                    success: true,
                    message: 'Connected successfully',
                    data: {
                        spreadsheetId: id,
                        headers: headers,
                        rowCount: Math.max(0, lines.length - 1)
                    }
                };
            }

            return {
                success: false,
                error: 'Could not access spreadsheet. Make sure it is shared with "Anyone with the link can view"'
            };
        } catch (err) {
            console.error('Google Sheets test connection error:', err.message);
            
            if (err.response?.status === 404) {
                return {
                    success: false,
                    error: 'Spreadsheet not found. Check the URL is correct.'
                };
            }
            
            if (err.response?.status === 403 || err.response?.status === 401) {
                return {
                    success: false,
                    error: 'Access denied. Make sure your sheet is shared with "Anyone with the link can view" or "Anyone with the link can edit"'
                };
            }

            return {
                success: false,
                error: 'Could not access spreadsheet. Make sure it is shared with "Anyone with the link can view"'
            };
        }
    }

    /**
     * Read data from a spreadsheet via CSV export
     */
    async readSheet(spreadsheetId = null, sheetName = null) {
        const id = spreadsheetId || this.spreadsheetId;
        
        if (!id) {
            throw new Error('No spreadsheet ID provided');
        }

        try {
            const csvUrl = GoogleSheetsService.getCsvUrl(id, sheetName);
            const response = await axios.get(csvUrl, {
                timeout: 30000,
                maxRedirects: 5
            });

            if (!response.data) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Parse CSV
            const lines = response.data.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Parse headers
            const headers = this.parseCsvLine(lines[0]);
            const columnMap = this.detectColumns(headers);

            // Parse data rows
            const data = [];
            for (let i = 1; i < lines.length; i++) {
                const rowValues = this.parseCsvLine(lines[i]);
                const rowData = { _rowIndex: i + 1 }; // 1-based with header
                
                headers.forEach((header, colIndex) => {
                    const key = columnMap[header] || this.sanitizeColumnName(header);
                    rowData[key] = rowValues[colIndex] || '';
                });
                
                data.push(rowData);
            }

            return {
                success: true,
                data,
                columns: columnMap,
                headers,
                totalRows: data.length
            };
        } catch (err) {
            console.error('Read sheet error:', err.message);
            
            if (err.response?.status === 403 || err.response?.status === 401) {
                throw new Error('Access denied. Make sure your sheet is shared with "Anyone with the link can view"');
            }
            
            throw new Error('Failed to read spreadsheet: ' + (err.message || 'Unknown error'));
        }
    }

    /**
     * Parse a CSV line handling quoted values
     */
    parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        // Don't forget the last value
        values.push(current.trim());
        
        return values;
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
     * Note: This requires the sheet to be editable via Apps Script or similar
     * For now, this is a placeholder - CSV export is read-only
     */
    async updateCells(spreadsheetId, updates, sheetName = 'Sheet1') {
        // CSV export is read-only
        // To support writes, we'd need to use Google Apps Script or OAuth
        throw new Error('Write operations require OAuth authentication. Please use the Google Sheets API with OAuth for write access.');
    }

    /**
     * Update row status and add metadata
     * Note: This requires write access via OAuth
     */
    async updateRowStatus(spreadsheetId, rowIndex, status, metadata = {}, sheetName = 'Sheet1', headers = []) {
        // CSV export is read-only
        throw new Error('Write operations require OAuth authentication. Please use the Google Sheets API with OAuth for write access.');
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
     * Note: Requires OAuth
     */
    async appendRows(spreadsheetId, rows, sheetName = 'Sheet1') {
        throw new Error('Write operations require OAuth authentication. Please use the Google Sheets API with OAuth for write access.');
    }

    /**
     * Create a new spreadsheet
     * Note: Requires OAuth
     */
    async createSpreadsheet(title, sheets = ['Topics']) {
        throw new Error('Create spreadsheet requires OAuth authentication. Please create a sheet manually and share it with "Anyone with the link can edit".');
    }

    /**
     * Get sharing instructions for users
     */
    static getSharingInstructions() {
        return {
            title: 'Share your Google Sheet',
            steps: [
                'Open your Google Sheet',
                'Click "Share" in the top right',
                'Change "Restricted" to "Anyone with the link"',
                'Set permission to "Viewer" (read-only) or "Editor" (read/write)',
                'Copy the link and paste it here'
            ],
            note: 'We only need "Viewer" access to read your content. "Editor" access is only needed if you want us to update statuses automatically.'
        };
    }
}

module.exports = GoogleSheetsService;
