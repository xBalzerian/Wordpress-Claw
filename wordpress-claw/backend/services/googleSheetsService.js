/**
 * Google Sheets Service - Service Account Version
 * Full read/write access using Google Service Account
 * 
 * Setup:
 * 1. Create service account in Google Cloud Console
 * 2. Download JSON key file
 * 3. Set GOOGLE_SERVICE_ACCOUNT_KEY environment variable (base64 encoded JSON)
 * 4. Share spreadsheet with service account email
 */

const { google } = require('googleapis');
const db = require('../database/db');

class GoogleSheetsService {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.initialized = false;
    }

    /**
     * Initialize with service account credentials
     */
    async initialize() {
        if (this.initialized) return true;

        const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        
        if (!keyJson) {
            throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured. Please set the environment variable with base64-encoded service account JSON.');
        }

        try {
            // Decode base64 key
            const decodedKey = Buffer.from(keyJson, 'base64').toString('utf8');
            const credentials = JSON.parse(decodedKey);

            // Create auth client
            this.auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });

            // Create sheets API client
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            
            this.initialized = true;
            console.log('✅ Google Sheets Service initialized successfully');
            return true;
        } catch (err) {
            console.error('Failed to initialize Google Sheets:', err);
            throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY. Make sure it is base64-encoded valid JSON.');
        }
    }

    /**
     * Extract spreadsheet ID from URL
     */
    static extractSpreadsheetId(url) {
        if (!url || typeof url !== 'string') return null;

        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
            /^([a-zA-Z0-9-_]{40,})$/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    /**
     * Get service account email to display to users
     */
    getServiceAccountEmail() {
        const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (!keyJson) return null;
        
        try {
            const decodedKey = Buffer.from(keyJson, 'base64').toString('utf8');
            const credentials = JSON.parse(decodedKey);
            return credentials.client_email;
        } catch {
            return null;
        }
    }

    /**
     * Test connection to a spreadsheet
     */
    async testConnection(spreadsheetId) {
        try {
            await this.initialize();

            const response = await this.sheets.spreadsheets.get({
                spreadsheetId
            });

            return {
                success: true,
                message: 'Connected successfully',
                data: {
                    title: response.data.properties.title,
                    sheets: response.data.sheets.map(s => ({
                        id: s.properties.sheetId,
                        title: s.properties.title
                    }))
                }
            };
        } catch (err) {
            console.error('Test connection error:', err);
            
            if (err.code === 403) {
                return {
                    success: false,
                    error: 'Access denied. Please share the spreadsheet with: ' + this.getServiceAccountEmail()
                };
            }
            
            if (err.code === 404) {
                return {
                    success: false,
                    error: 'Spreadsheet not found. Check the URL/ID.'
                };
            }

            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Read data from a sheet
     */
    async readSheet(spreadsheetId, sheetName = 'Sheet1') {
        try {
            await this.initialize();

            // Get first sheet name if not specified
            let targetSheetName = sheetName;
            if (!targetSheetName || targetSheetName === 'Sheet1') {
                const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
                targetSheetName = spreadsheet.data.sheets[0].properties.title;
            }
            
            const range = `${targetSheetName}!A1:Z1000`;
            
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) {
                return {
                    success: true,
                    data: [],
                    headers: [],
                    totalRows: 0
                };
            }

            const headers = rows[0];
            const dataRows = rows.slice(1).map((row, index) => {
                const obj = { _rowIndex: index + 2 }; // 1-based with header
                headers.forEach((header, colIndex) => {
                    obj[header] = row[colIndex] || ''; // Use original header as key
                });
                return obj;
            });

            return {
                success: true,
                data: dataRows,
                headers: headers, // Return original headers
                totalRows: dataRows.length,
                raw: rows
            };
        } catch (err) {
            console.error('Read sheet error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Write data to a sheet (append rows)
     */
    async appendRows(spreadsheetId, sheetName, rows) {
        try {
            await this.initialize();

            const range = `${sheetName}!A1`;
            
            await this.sheets.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: rows
                }
            });

            return {
                success: true,
                message: `Appended ${rows.length} rows`
            };
        } catch (err) {
            console.error('Append rows error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Update specific cell
     */
    async updateCell(spreadsheetId, sheetName, cell, value) {
        try {
            await this.initialize();

            const range = `${sheetName}!${cell}`;
            
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[value]]
                }
            });

            return {
                success: true,
                message: `Updated ${cell}`
            };
        } catch (err) {
            console.error('Update cell error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Update a row by index
     */
    async updateRow(spreadsheetId, sheetName, rowIndex, values) {
        try {
            await this.initialize();

            const range = `${sheetName}!A${rowIndex}:Z${rowIndex}`;
            
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [values]
                }
            });

            return {
                success: true,
                message: `Updated row ${rowIndex}`
            };
        } catch (err) {
            console.error('Update row error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Update specific columns in a row
     */
    async updateRowColumns(spreadsheetId, sheetName, rowIndex, headers, updates) {
        try {
            await this.initialize();

            // First read the current row
            const currentRow = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A${rowIndex}:Z${rowIndex}`
            });

            let rowValues = currentRow.data.values?.[0] || [];
            
            // Extend array if needed
            while (rowValues.length < headers.length) {
                rowValues.push('');
            }

            // Apply updates
            for (const [columnName, value] of Object.entries(updates)) {
                const colIndex = headers.findIndex(h => 
                    this.sanitizeColumnName(h) === this.sanitizeColumnName(columnName)
                );
                if (colIndex !== -1) {
                    rowValues[colIndex] = value;
                }
            }

            // Write back
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A${rowIndex}:Z${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [rowValues]
                }
            });

            return {
                success: true,
                message: `Updated row ${rowIndex}`
            };
        } catch (err) {
            console.error('Update row columns error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Create a new spreadsheet
     */
    async createSpreadsheet(title, sheetNames = ['Sheet1']) {
        try {
            await this.initialize();

            const request = {
                requestBody: {
                    properties: { title },
                    sheets: sheetNames.map(name => ({
                        properties: { title: name }
                    }))
                }
            };

            const response = await this.sheets.spreadsheets.create(request);

            return {
                success: true,
                data: {
                    spreadsheetId: response.data.spreadsheetId,
                    spreadsheetUrl: response.data.spreadsheetUrl,
                    title: response.data.properties.title
                }
            };
        } catch (err) {
            console.error('Create spreadsheet error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Sanitize column name for use as object key
     */
    sanitizeColumnName(name) {
        if (!name) return '';
        return name
            .toString()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Find rows by status
     */
    findRowsByStatus(data, status, statusColumn = 'status') {
        const statusLower = status.toLowerCase();
        return data.filter(row => {
            const rowStatus = (row[statusColumn] || '').toString().toLowerCase();
            return rowStatus === statusLower || rowStatus.includes(statusLower);
        });
    }

    /**
     * Find pending rows
     */
    findPendingRows(data, statusColumn = 'status') {
        return data.filter(row => {
            const rawStatus = (row[statusColumn] || 'PENDING').toString().trim();
            const status = rawStatus.toLowerCase();
            return status === 'pending' || status === '' || status === 'todo' || status === 'new';
        });
    }
}

module.exports = new GoogleSheetsService();
