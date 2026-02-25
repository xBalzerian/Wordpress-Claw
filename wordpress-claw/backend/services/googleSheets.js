/**
 * Google Sheets Service
 * Uses Google's public CSV export for simple, API-key-free reading
 * Sheets must be shared with "Anyone with the link can view"
 */

const axios = require('axios');

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
     * Test connection to a Google Sheet using CSV export
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
            // Try to read the first sheet using CSV export
            const result = await this.readSheet(id, 'Sheet1');
            
            if (result.success) {
                return {
                    success: true,
                    message: 'Connected successfully',
                    data: {
                        spreadsheetId: id,
                        sheetFound: true,
                        rowCount: result.data?.length || 0,
                        headers: result.headers || []
                    }
                };
            }
            
            return {
                success: false,
                error: result.error || 'Could not read spreadsheet'
            };
        } catch (err) {
            console.error('Google Sheets test connection error:', err.message);
            
            return {
                success: false,
                error: this.getFriendlyError(err)
            };
        }
    }

    /**
     * Read data from a spreadsheet using CSV export (no API key needed)
     */
    async readSheet(spreadsheetId = null, sheetName = 'Sheet1') {
        const id = spreadsheetId || this.spreadsheetId;
        
        if (!id) {
            return {
                success: false,
                error: 'No spreadsheet ID provided'
            };
        }

        try {
            // Use Google's public CSV export (no auth needed)
            // Sheet must be shared with "Anyone with the link can view"
            const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
            
            const response = await axios.get(csvUrl, {
                timeout: 10000,
                responseType: 'text'
            });

            const csvData = response.data;
            
            if (!csvData || csvData.trim().length === 0) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Parse CSV
            const parsed = this.parseCSV(csvData);
            
            if (parsed.length === 0) {
                return {
                    success: true,
                    data: [],
                    columns: {},
                    headers: []
                };
            }

            // Parse headers (first row)
            const headers = parsed[0].map(h => h || '');
            const columnMap = this.detectColumns(headers);

            // Parse data rows
            const data = [];
            for (let i = 1; i < parsed.length; i++) {
                const rowValues = parsed[i] || [];
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
            
            return {
                success: false,
                error: this.getFriendlyError(err)
            };
        }
    }

    /**
     * Parse CSV text into array of arrays
     * Handles quoted values and commas within quotes
     */
    parseCSV(csvText) {
        const rows = [];
        let currentRow = [];
        let currentCell = '';
        let insideQuotes = false;
        
        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];
            
            if (insideQuotes) {
                if (char === '"') {
                    if (nextChar === '"') {
                        // Escaped quote
                        currentCell += '"';
                        i++; // Skip next quote
                    } else {
                        // End of quoted string
                        insideQuotes = false;
                    }
                } else {
                    currentCell += char;
                }
            } else {
                if (char === '"') {
                    // Start of quoted string
                    insideQuotes = true;
                } else if (char === ',') {
                    // End of cell
                    currentRow.push(currentCell.trim());
                    currentCell = '';
                } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                    // End of row
                    if (char === '\r') i++; // Skip \n after \r
                    currentRow.push(currentCell.trim());
                    if (currentRow.length > 0 && currentRow.some(cell => cell.length > 0)) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentCell = '';
                } else if (char === '\r') {
                    // Just \r (old Mac style)
                    currentRow.push(currentCell.trim());
                    if (currentRow.length > 0 && currentRow.some(cell => cell.length > 0)) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentCell = '';
                } else {
                    currentCell += char;
                }
            }
        }
        
        // Don't forget the last cell/row
        if (currentCell.length > 0 || currentRow.length > 0) {
            currentRow.push(currentCell.trim());
            if (currentRow.length > 0 && currentRow.some(cell => cell.length > 0)) {
                rows.push(currentRow);
            }
        }
        
        return rows;
    }

    /**
     * Get a user-friendly error message
     */
    getFriendlyError(err) {
        if (err.response) {
            const status = err.response.status;
            
            if (status === 404) {
                return 'Spreadsheet not found. Check the URL is correct and the sheet is shared with "Anyone with the link can view".';
            }
            
            if (status === 403) {
                return 'Access denied. Make sure your sheet is shared with "Anyone with the link can view".';
            }
            
            if (status === 400) {
                return 'Invalid request. Check your spreadsheet ID and sheet name.';
            }
            
            if (status === 429) {
                return 'Too many requests. Please wait a moment and try again.';
            }
        }
        
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            return 'Connection timed out. Please try again.';
        }
        
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
            return 'Could not connect to Google Sheets. Check your internet connection.';
        }
        
        // Check for the specific Google error page content
        if (err.response?.data && typeof err.response.data === 'string') {
            if (err.response.data.includes('Moved Temporarily') || 
                err.response.data.includes('Redirecting') ||
                err.response.data.includes('<!DOCTYPE')) {
                return 'Could not read sheet. Make sure it is shared with "Anyone with the link can view".';
            }
        }
        
        return 'Could not read spreadsheet: ' + (err.message || 'Unknown error');
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
            const rawStatus = (row[statusColumn] || 'PENDING').toString().trim();
            const status = rawStatus.toLowerCase();

            // Only truly "pending" if explicitly marked or empty
            if (status === 'pending' || status === '' || status === 'todo' || status === 'new') {
                return true;
            }

            // Check WP URL column - if empty, it's pending
            const wpUrlColumn = Object.keys(row).find(k =>
                k.toLowerCase().includes('wp') && k.toLowerCase().includes('url')
            );
            if (wpUrlColumn && (!row[wpUrlColumn] || row[wpUrlColumn].toString().trim() === '')) {
                return true;
            }

            return false;
        });
    }

    /**
     * Update cell values in the spreadsheet
     * Note: This requires write access (Google Apps Script or OAuth)
     */
    async updateCells(spreadsheetId, updates, sheetName = 'Sheet1') {
        throw new Error('Write operations require Google Apps Script or OAuth. See documentation for setup instructions.');
    }

    /**
     * Update row status and add metadata
     * Note: This requires write access (Google Apps Script or OAuth)
     */
    async updateRowStatus(spreadsheetId, rowIndex, status, metadata = {}, sheetName = 'Sheet1', headers = []) {
        throw new Error('Write operations require Google Apps Script or OAuth. See documentation for setup instructions.');
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
     * Note: Requires write access
     */
    async appendRows(spreadsheetId, rows, sheetName = 'Sheet1') {
        throw new Error('Write operations require Google Apps Script or OAuth. See documentation for setup instructions.');
    }

    /**
     * Create a new spreadsheet
     * Note: Requires OAuth
     */
    async createSpreadsheet(title, sheets = ['Topics']) {
        throw new Error('Create spreadsheet requires OAuth authentication. Please create a sheet manually and share it with "Anyone with the link can view".');
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
                'Set permission to "Viewer" (we only need to read)',
                'Copy the link and paste it here'
            ],
            note: 'No API key needed! We use Google\'s public CSV export. Your sheet just needs to be viewable by anyone with the link.'
        };
    }
}

module.exports = GoogleSheetsService;
