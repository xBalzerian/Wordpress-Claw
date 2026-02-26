// Config
const API_URL = '';
const token = localStorage.getItem('token');
if (!token) window.location.href = '/login.html';

// User info
const user = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('userName').textContent = user.name || 'User';
document.getElementById('userTier').textContent = (user.tier || 'free') + ' Plan';
document.getElementById('userAvatar').textContent = (user.name || 'U').charAt(0).toUpperCase();

// State
let currentData = [];
let currentFilter = 'all';

// Initialize
loadData();

// Show alert
function showAlert(message, type = 'info') {
    const container = document.getElementById('alertContainer');
    container.innerHTML = `<div class="alert ${type}">${message}</div>`;
    setTimeout(() => container.innerHTML = '', 4000);
}

// Load data from API
async function loadData() {
    try {
        document.getElementById('loadingState').style.display = 'block';
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('spreadsheetTable').style.display = 'none';

        const response = await fetch(`${API_URL}/api/spreadsheet-simple/data`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();

        document.getElementById('loadingState').style.display = 'none';

        if (!result.success) {
            showAlert(result.error || 'Failed to load data', 'error');
            return;
        }

        currentData = result.data.rows || [];
        updateStats(result.data.stats || {});
        renderTable();

    } catch (err) {
        console.error('Load error:', err);
        document.getElementById('loadingState').style.display = 'none';
        showAlert('Failed to load spreadsheet data', 'error');
    }
}

// Update stats
function updateStats(stats) {
    document.getElementById('totalCount').textContent = stats.total || 0;
    document.getElementById('pendingCount').textContent = stats.pending || 0;
    document.getElementById('processingCount').textContent = stats.processing || 0;
    document.getElementById('completedCount').textContent = stats.done || 0;
}

// Render table
function renderTable() {
    const tbody = document.getElementById('tableBody');
    
    if (currentData.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
        document.getElementById('spreadsheetTable').style.display = 'none';
        return;
    }

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('spreadsheetTable').style.display = 'table';

    // Filter rows
    let filteredData = currentData;
    if (currentFilter !== 'all') {
        filteredData = currentData.filter(row => 
            (row.status || 'PENDING').toLowerCase() === currentFilter.toLowerCase()
        );
    }

    tbody.innerHTML = filteredData.map(row => `
        <tr data-id="${row.id}">
            <td>
                <input type="text" 
                    class="cell-input url-cell" 
                    data-field="service_url" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.service_url || '')}"
                    placeholder="https://..."
                    onblur="saveCell(this)"
                >
            </td>
            <td>
                <input type="text" 
                    class="cell-input" 
                    data-field="main_keyword" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.main_keyword || '')}"
                    placeholder="Enter keyword..."
                    onblur="saveCell(this)"
                >
            </td>
            <td>
                ${renderClusterKeywords(row.cluster_keywords, row.id)}
            </td>
            <td>
                <input type="text" 
                    class="cell-input url-cell" 
                    data-field="gdocs_link" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.gdocs_link || '')}"
                    placeholder="Google Doc link..."
                    onblur="saveCell(this)"
                >
            </td>
            <td>
                <input type="text" 
                    class="cell-input url-cell" 
                    data-field="wp_post_url" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.wp_post_url || '')}"
                    placeholder="WordPress URL..."
                    onblur="saveCell(this)"
                >
            </td>
            <td>
                <input type="text" 
                    class="cell-input status-input status-${(row.status || 'PENDING').toLowerCase()}" 
                    data-field="status" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.status || 'PENDING')}"
                    placeholder="PENDING, PROCESSING, DONE, ERROR"
                    onblur="saveCell(this)"
                    onchange="updateStatusClass(this)"
                >
            </td>
            <td>
                <input type="text" 
                    class="cell-input url-cell" 
                    data-field="feature_image" 
                    data-id="${row.id}"
                    value="${escapeHtml(row.feature_image || '')}"
                    placeholder="Image URL..."
                    onblur="saveCell(this)"
                >
            </td>
            <td>
                <div class="row-actions">
                    <button class="btn-icon process" onclick="processRow(${row.id})" title="Process">⚡</button>
                    <button class="btn-icon delete" onclick="deleteRow(${row.id})" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Render cluster keywords with expandable tooltip
function renderClusterKeywords(keywords, rowId) {
    if (!keywords) return '<input type="text" class="cell-input" data-field="cluster_keywords" data-id="' + rowId + '" value="" placeholder="keyword1, keyword2..." onblur="saveCell(this)">';
    
    const keywordsList = keywords.split(',').map(k => k.trim()).filter(k => k);
    const firstKeyword = keywordsList[0] || '';
    const remainingCount = keywordsList.length - 1;
    
    if (keywordsList.length <= 1) {
        return `<input type="text" 
            class="cell-input" 
            data-field="cluster_keywords" 
            data-id="${rowId}"
            value="${escapeHtml(keywords)}"
            placeholder="keyword1, keyword2..."
            onblur="saveCell(this)"
        >`;
    }
    
    return `<div class="cluster-keywords-cell" onclick="editClusterKeywords(${rowId})">
        <span class="cluster-first">${escapeHtml(firstKeyword)}</span>
        <span class="cluster-count">+${remainingCount} more</span>
        <div class="cluster-tooltip">${escapeHtml(keywords)}</div>
    </div>`;
}

// Edit cluster keywords inline
function editClusterKeywords(rowId) {
    const row = currentData.find(r => r.id == rowId);
    if (!row) return;
    
    const cell = document.querySelector(`tr[data-id="${rowId}"] td:nth-child(3)`);
    if (!cell) return;
    
    cell.innerHTML = `<input type="text" 
        class="cell-input" 
        data-field="cluster_keywords" 
        data-id="${rowId}"
        value="${escapeHtml(row.cluster_keywords || '')}"
        placeholder="keyword1, keyword2..."
        onblur="saveCell(this)"
        autofocus
    >`;
    
    const input = cell.querySelector('input');
    input.focus();
    input.select();
}

// Save cell on blur
async function saveCell(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;
    const value = input.value.trim();

    // Find original value
    const row = currentData.find(r => r.id == id);
    if (!row) return;

    const originalValue = row[field] || '';
    if (value === originalValue) return;

    // Update local data
    row[field] = value;

    // Save to server
    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/row/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ [field]: value })
        });

        const result = await response.json();
        if (!result.success) {
            showAlert('Failed to save: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showAlert('Failed to save changes', 'error');
    }
}

// Update status class based on input value
function updateStatusClass(input) {
    const value = input.value.trim().toUpperCase();
    input.className = `cell-input status-input status-${value.toLowerCase()}`;
}

// Update status
async function updateStatus(id, status) {
    const row = currentData.find(r => r.id == id);
    if (row) {
        row.status = status;
        renderTable();
    }

    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/row/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });

        const result = await response.json();
        if (!result.success) {
            showAlert('Failed to update status: ' + (result.error || 'Unknown error'), 'error');
        } else {
            loadData();
        }
    } catch (err) {
        showAlert('Failed to update status', 'error');
    }
}

// Process row
async function processRow(id) {
    const row = currentData.find(r => r.id == id);
    if (!row || !row.main_keyword) {
        showAlert('No main keyword found for this row', 'error');
        return;
    }

    // Update status locally
    row.status = 'PROCESSING';
    renderTable();

    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/process/${id}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        if (result.success) {
            showAlert('✅ ' + result.message, 'success');
        } else {
            showAlert(result.error || 'Processing failed', 'error');
            row.status = 'ERROR';
            renderTable();
        }
    } catch (err) {
        showAlert('Failed to process row', 'error');
        row.status = 'ERROR';
        renderTable();
    } finally {
        setTimeout(loadData, 500);
    }
}

// Delete row
async function deleteRow(id) {
    if (!confirm('Are you sure you want to delete this row?')) return;

    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/row/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();
        if (result.success) {
            currentData = currentData.filter(r => r.id != id);
            renderTable();
            showAlert('Row deleted', 'success');
            loadData();
        } else {
            showAlert(result.error || 'Delete failed', 'error');
        }
    } catch (err) {
        showAlert('Failed to delete row', 'error');
    }
}

// Add new row
async function addNewRow() {
    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/row`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                service_url: '',
                main_keyword: '',
                cluster_keywords: '',
                status: 'PENDING'
            })
        });

        const result = await response.json();
        if (result.success && result.data) {
            currentData.push({
                id: result.data.id,
                service_url: '',
                main_keyword: '',
                cluster_keywords: '',
                gdocs_link: '',
                wp_post_url: '',
                status: 'PENDING',
                feature_image: '',
                row_order: result.data.row_order
            });
            renderTable();
            showAlert('New row added', 'success');
        } else {
            showAlert(result.error || 'Failed to add row', 'error');
        }
    } catch (err) {
        showAlert('Failed to add row', 'error');
    }
}

// Clear all data
async function clearAllData() {
    if (!confirm('Are you sure you want to clear ALL data? This cannot be undone.')) return;

    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/clear`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();
        if (result.success) {
            currentData = [];
            renderTable();
            updateStats({ total: 0, pending: 0, processing: 0, done: 0 });
            showAlert('All data cleared', 'success');
        } else {
            showAlert(result.error || 'Clear failed', 'error');
        }
    } catch (err) {
        showAlert('Failed to clear data', 'error');
    }
}

// Set filter
function setFilter(filter) {
    currentFilter = filter;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    
    renderTable();
}

// Import Modal
function showImportModal() {
    document.getElementById('importModal').classList.add('show');
    document.getElementById('importTextarea').focus();
}

function hideImportModal() {
    document.getElementById('importModal').classList.remove('show');
}

async function importData() {
    const data = document.getElementById('importTextarea').value.trim();
    
    if (!data) {
        showAlert('Please paste some data first', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data })
        });

        const result = await response.json();
        if (result.success) {
            showAlert('✅ ' + result.message, 'success');
            hideImportModal();
            document.getElementById('importTextarea').value = '';
            loadData();
        } else {
            showAlert(result.error || 'Import failed', 'error');
        }
    } catch (err) {
        showAlert('Failed to import data', 'error');
    }
}

// Export Modal
async function showExportModal() {
    try {
        const response = await fetch(`${API_URL}/api/spreadsheet-simple/export`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        if (result.success) {
            document.getElementById('exportContent').textContent = result.data.tsv || result.data || 'No data to export';
            document.getElementById('exportModal').classList.add('show');
        } else {
            showAlert(result.error || 'Export failed', 'error');
        }
    } catch (err) {
        showAlert('Failed to export data', 'error');
    }
}

function hideExportModal() {
    document.getElementById('exportModal').classList.remove('show');
}

function copyToClipboard() {
    const content = document.getElementById('exportContent').textContent;
    navigator.clipboard.writeText(content).then(() => {
        showAlert('✅ Copied to clipboard!', 'success');
        hideExportModal();
    }).catch(() => {
        showAlert('Failed to copy. Please select and copy manually.', 'error');
    });
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('show');
        }
    });
});
