/**
 * Google Sheets Service
 * Uses Google Sheets API v4 for reliable access to public sheets
 */

const axios = require('axios');

// API key for Google Sheets API v4 (public sheets only)
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || '';

class GoogleSheetsService {
    constructor(credentials = {}) {
        this.credentials = credentials;
        this.spreadsheetId = credentials.spreadsheetId || null;
        
        // Extract spreadsheet ID from URL if provided
        if (credentials.spreadsheetUrl && !this.spreadsheetId) {
            this.spreadsheetId = GoogleSheetsService.extractSpreadsheetId(credentials.spreadsheetUrl);
        }
    }

    /**
     * Initialize the service (compatibility method)
     */
    async initialize() {
        if (!this.spreadsheetId) {
            throw new Error('No spreadsheet ID available. Please provide a valid Google Sheets URL.');
        }
        return true;
    }

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
     * Test connection to a Google Sheet using Sheets API v4
     */
    async testConnection(spreadsheetId = null) {
        const id = spreadsheetId || this.spreadsheetId;
        
        if (!id) {
            return {
                success: false,
                error: 'No spreadsheet ID provided'
            };
        }

        if (!API_KEY) {
            return {
                success: false,
                error: 'Google Sheets API key not configured. Please set GOOGLE_SHEETS_API_KEY environment variable.'
            };
        }

        try {
            // Use Sheets API v4 to get spreadsheet metadata
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${API_KEY}&fields=properties.title,sheets.properties.title`;
            
            const response = await axios.get(url, {
                timeout: 10000
            });

            if (response.status === 200 && response.data) {
                const { properties, sheets } = response.data;
                const sheetNames = sheets ? sheets.map(s => s.properties?.title).filter(Boolean) : [];
                
                return {
                    success: true,
                    message: 'Connected successfully',
                    data: {
                        spreadsheetId: id,
                        title: properties?.title || 'Untitled',
                        sheets: sheetNames,
                        sheetCount: sheetNames.length
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
            
            if (err.response?.status === 403) {
                return {
                    success: false,
                    error: 'Access denied. Make sure your sheet is shared with "Anyone with the link can view" or check your API key.'
                };
            }

            if (err.response?.status === 400) {
                return {
                    success: false,
                    error: 'Invalid request. Check your spreadsheet ID and API key.'
                };
            }

            return {
                success: false,
                error: 'Could not access spreadsheet: ' + (err.message || 'Unknown error')
            };
        }
    }

    /**
     * Read data from a spreadsheet using Sheets API v4
     */
    async readSheet(spreadsheetId = null, sheetName = 'Sheet1') {
        const id = spreadsheetId || this.spreadsheetId;
        
        if (!id) {
            throw new Error('No spreadsheet ID provided');
        }

        if (!API_KEY) {
            throw new Error('Google Sheets API key not configured. Please set GOOGLE_SHEETS_API_KEY environment variable.');
        }

        try {
            // Use Sheets API v4 to get sheet values
            const range = encodeURIComponent(sheetName);
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?key=${API_KEY}`;
            
            const response = await axios.get(url, {
                timeout: 30000
            });

            if (!response.data || !response.data.values) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            const values = response.data.values;
            
            if (values.length === 0) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Parse headers (first row)
            const headers = values[0].map(h => h || '');
            const columnMap = this.detectColumns(headers);

            // Parse data rows
            const data = [];
            for (let i = 1; i < values.length; i++) {
                const rowValues = values[i] || [];
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
            
            if (err.response?.status === 403) {
                throw new Error('Access denied. Make sure your sheet is shared with "Anyone with the link can view"');
            }
            
            if (err.response?.status === 404) {
                throw new Error('Sheet not found. Check the sheet name exists.');
            }
            
            throw new Error('Failed to read spreadsheet: ' + (err.message || 'Unknown error'));
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
     * Note: This requires OAuth authentication
     */
    async updateCells(spreadsheetId, updates, sheetName = 'Sheet1') {
        throw new Error('Write operations require OAuth authentication. Please use the Google Sheets API with OAuth for write access.');
    }

    /**
     * Update row status and add metadata
     * Note: This requires OAuth authentication
     */
    async updateRowStatus(spreadsheetId, rowIndex, status, metadata = {}, sheetName = 'Sheet1', headers = []) {
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
