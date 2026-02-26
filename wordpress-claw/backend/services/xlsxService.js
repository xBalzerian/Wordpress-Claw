const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * XLSX Service - Handles Excel/Spreadsheet file operations
 * Uses SheetJS (xlsx) library for reading/writing Excel files
 */
class XlsxService {
    /**
     * Read an Excel or CSV file and return JSON data
     * @param {string} filePath - Path to the file
     * @param {Object} options - Parsing options
     * @returns {Object} - Parsed data with headers and rows
     */
    static readFile(filePath, options = {}) {
        try {
            const workbook = XLSX.readFile(filePath, {
                type: 'file',
                cellFormula: false,
                cellHTML: false,
                ...options
            });

            // Get first sheet by default, or specified sheet
            const sheetName = options.sheetName || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) {
                throw new Error(`Sheet "${sheetName}" not found in workbook`);
            }

            // Convert to JSON with headers
            const rawData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                blankrows: false
            });

            if (rawData.length === 0) {
                return {
                    success: true,
                    headers: [],
                    rows: [],
                    sheetName,
                    totalSheets: workbook.SheetNames.length,
                    sheetNames: workbook.SheetNames
                };
            }

            // Extract headers from first row
            const headers = rawData[0].map(h => String(h).trim());
            
            // Convert remaining rows to objects
            const rows = rawData.slice(1).map((row, index) => {
                const obj = { _rowIndex: index + 2 }; // 1-based row index (header is row 1)
                headers.forEach((header, colIndex) => {
                    obj[header] = row[colIndex] !== undefined ? row[colIndex] : '';
                });
                return obj;
            });

            return {
                success: true,
                headers,
                rows,
                sheetName,
                totalSheets: workbook.SheetNames.length,
                sheetNames: workbook.SheetNames,
                rowCount: rows.length
            };
        } catch (error) {
            console.error('XLSX read error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Read file from buffer (for uploaded files)
     * @param {Buffer} buffer - File buffer
     * @param {string} filename - Original filename (for format detection)
     * @param {Object} options - Parsing options
     * @returns {Object} - Parsed data
     */
    static readBuffer(buffer, filename, options = {}) {
        try {
            // Detect file type from extension
            const ext = path.extname(filename).toLowerCase();
            const isCSV = ext === '.csv';

            const workbook = XLSX.read(buffer, {
                type: 'buffer',
                cellFormula: false,
                cellHTML: false,
                ...(isCSV && { codepage: 65001 }) // UTF-8 for CSV
            });

            const sheetName = options.sheetName || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) {
                throw new Error(`Sheet "${sheetName}" not found`);
            }

            const rawData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                blankrows: false
            });

            if (rawData.length === 0) {
                return {
                    success: true,
                    headers: [],
                    rows: [],
                    sheetName,
                    filename
                };
            }

            const headers = rawData[0].map(h => String(h).trim());
            const rows = rawData.slice(1).map((row, index) => {
                const obj = { _rowIndex: index + 2 };
                headers.forEach((header, colIndex) => {
                    obj[header] = row[colIndex] !== undefined ? row[colIndex] : '';
                });
                return obj;
            });

            return {
                success: true,
                headers,
                rows,
                sheetName,
                filename,
                totalSheets: workbook.SheetNames.length,
                sheetNames: workbook.SheetNames,
                rowCount: rows.length
            };
        } catch (error) {
            console.error('XLSX buffer read error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Write data to Excel file
     * @param {Array} headers - Column headers
     * @param {Array} rows - Array of row objects or arrays
     * @param {string} outputPath - Output file path
     * @param {Object} options - Writing options
     * @returns {Object} - Result object
     */
    static writeFile(headers, rows, outputPath, options = {}) {
        try {
            // Convert rows to arrays if they're objects
            const dataRows = rows.map(row => {
                if (Array.isArray(row)) return row;
                return headers.map(h => row[h] !== undefined ? row[h] : '');
            });

            // Create worksheet
            const worksheetData = [headers, ...dataRows];
            const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

            // Auto-size columns
            const colWidths = headers.map((header, i) => {
                const maxLength = Math.max(
                    String(header).length,
                    ...dataRows.map(row => String(row[i] || '').length)
                );
                return { wch: Math.min(maxLength + 2, 50) }; // Cap at 50 chars
            });
            worksheet['!cols'] = colWidths;

            // Create workbook
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName || 'Sheet1');

            // Write to file
            XLSX.writeFile(workbook, outputPath, {
                bookType: options.bookType || 'xlsx',
                ...options
            });

            return {
                success: true,
                path: outputPath,
                rowCount: rows.length,
                columnCount: headers.length
            };
        } catch (error) {
            console.error('XLSX write error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Write data to buffer (for download)
     * @param {Array} headers - Column headers
     * @param {Array} rows - Array of row objects or arrays
     * @param {Object} options - Writing options
     * @returns {Buffer} - Excel file buffer
     */
    static writeBuffer(headers, rows, options = {}) {
        try {
            // Convert rows to arrays if they're objects
            const dataRows = rows.map(row => {
                if (Array.isArray(row)) return row;
                return headers.map(h => row[h] !== undefined ? row[h] : '');
            });

            // Create worksheet
            const worksheetData = [headers, ...dataRows];
            const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

            // Auto-size columns
            const colWidths = headers.map((header, i) => {
                const maxLength = Math.max(
                    String(header).length,
                    ...dataRows.map(row => String(row[i] || '').length)
                );
                return { wch: Math.min(maxLength + 2, 50) };
            });
            worksheet['!cols'] = colWidths;

            // Create workbook
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName || 'Sheet1');

            // Write to buffer
            const buffer = XLSX.write(workbook, {
                type: 'buffer',
                bookType: options.bookType || 'xlsx',
                ...options
            });

            return {
                success: true,
                buffer,
                rowCount: rows.length,
                columnCount: headers.length
            };
        } catch (error) {
            console.error('XLSX write buffer error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Parse Google Sheets export URL or data
     * Google Sheets can be exported as CSV or XLSX via special URLs
     * @param {string} url - Google Sheets export URL
     * @returns {Object} - Parsed data
     */
    static async parseGoogleSheetsUrl(url) {
        try {
            // Convert Google Sheets URL to export URL if needed
            let exportUrl = url;
            
            // Handle different Google Sheets URL formats
            const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (sheetIdMatch) {
                const sheetId = sheetIdMatch[1];
                exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
            }

            // Fetch the file
            const response = await fetch(exportUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch Google Sheets: ${response.status}`);
            }

            const buffer = await response.arrayBuffer();
            return this.readBuffer(Buffer.from(buffer), 'sheet.xlsx');
        } catch (error) {
            console.error('Google Sheets parse error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update specific cells in an Excel file
     * @param {string} filePath - Path to existing file
     * @param {Array} updates - Array of {row, col, value} objects
     * @param {string} outputPath - Output path (optional, defaults to filePath)
     * @returns {Object} - Result object
     */
    static updateCells(filePath, updates, outputPath = null) {
        try {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Apply updates
            updates.forEach(({ row, col, value }) => {
                const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
                worksheet[cellRef] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
            });

            // Update range if needed
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            updates.forEach(({ row, col }) => {
                if (row > range.e.r) range.e.r = row;
                if (col > range.e.c) range.e.c = col;
            });
            worksheet['!ref'] = XLSX.utils.encode_range(range);

            // Write back
            XLSX.writeFile(workbook, outputPath || filePath);

            return {
                success: true,
                updatedCount: updates.length,
                path: outputPath || filePath
            };
        } catch (error) {
            console.error('XLSX update error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Convert content queue items to Excel format
     * @param {Array} items - Content queue items
     * @returns {Object} - Excel data ready for export
     */
    static convertContentQueueToExcel(items) {
        const headers = [
            'ID',
            'Main Keyword',
            'Service URL',
            'Cluster Keywords',
            'Status',
            'WP Post URL',
            'Feature Image',
            'Created At',
            'Updated At'
        ];

        const rows = items.map(item => [
            item.id,
            item.main_keyword || '',
            item.service_url || '',
            item.cluster_keywords || '',
            item.status || 'pending',
            item.wp_post_url || '',
            item.feature_image || '',
            item.created_at || '',
            item.updated_at || ''
        ]);

        return { headers, rows };
    }

    /**
     * Parse imported Excel/CSV data into content queue items
     * @param {Object} parsedData - Data from readFile/readBuffer
     * @returns {Object} - Parsed items and any errors
     */
    static parseContentQueueImport(parsedData) {
        const { headers, rows } = parsedData;
        const items = [];
        const errors = [];

        // Map common header variations
        const headerMap = {
            'main keyword': ['main keyword', 'keyword', 'main_keyword', 'topic', 'title'],
            'service url': ['service url', 'service_url', 'url', 'serviceurl', 'link'],
            'cluster keywords': ['cluster keywords', 'cluster_keywords', 'cluster', 'keywords', 'tags'],
            'status': ['status', 'state']
        };

        // Find actual column indices
        const columnIndices = {};
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());

        for (const [standard, variations] of Object.entries(headerMap)) {
            for (let i = 0; i < lowerHeaders.length; i++) {
                if (variations.includes(lowerHeaders[i])) {
                    columnIndices[standard] = i;
                    break;
                }
            }
        }

        // Process each row
        rows.forEach((row, index) => {
            const mainKeywordIndex = columnIndices['main keyword'];
            
            if (mainKeywordIndex === undefined) {
                errors.push(`Row ${index + 2}: Could not find 'Main Keyword' column`);
                return;
            }

            const mainKeyword = row[headers[mainKeywordIndex]] || row[mainKeywordIndex];
            
            if (!mainKeyword || String(mainKeyword).trim() === '') {
                errors.push(`Row ${index + 2}: Main keyword is required`);
                return;
            }

            const item = {
                main_keyword: String(mainKeyword).trim(),
                service_url: null,
                cluster_keywords: null,
                status: 'pending'
            };

            // Map other fields if they exist
            if (columnIndices['service url'] !== undefined) {
                const val = row[headers[columnIndices['service url']]];
                if (val) item.service_url = String(val).trim();
            }

            if (columnIndices['cluster keywords'] !== undefined) {
                const val = row[headers[columnIndices['cluster keywords']]];
                if (val) item.cluster_keywords = String(val).trim();
            }

            if (columnIndices['status'] !== undefined) {
                const val = row[headers[columnIndices['status']]];
                if (val) {
                    const status = String(val).toLowerCase().trim();
                    if (['pending', 'processing', 'done', 'error'].includes(status)) {
                        item.status = status;
                    }
                }
            }

            items.push(item);
        });

        return {
            success: errors.length === 0 || items.length > 0,
            items,
            errors,
            totalRows: rows.length,
            validItems: items.length
        };
    }

    /**
     * Validate file type
     * @param {string} filename - Filename to check
     * @returns {boolean} - Whether file is supported
     */
    static isSupportedFile(filename) {
        const supported = ['.xlsx', '.xls', '.csv', '.ods'];
        const ext = path.extname(filename).toLowerCase();
        return supported.includes(ext);
    }

    /**
     * Get file type from filename
     * @param {string} filename - Filename
     * @returns {string} - File type description
     */
    static getFileType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const types = {
            '.xlsx': 'Excel Workbook',
            '.xls': 'Excel 97-2003 Workbook',
            '.csv': 'CSV (Comma Separated Values)',
            '.ods': 'OpenDocument Spreadsheet'
        };
        return types[ext] || 'Unknown';
    }
}

module.exports = XlsxService;
