// ========================
// CONFIGURATION - SAME DOMAIN VERSION (NO CORS)
// ========================

// 🔥 CRITICAL FIX: Using relative path since frontend and backend are on same server
const API_BASE = '/api';  // Relative path - no CORS issues!

// Helper fetch with relative paths
async function apiCall(endpoint, options = {}) {
    // Build URL - if endpoint already has http prefix use it, otherwise prepend API_BASE
    let url;
    if (endpoint.startsWith('http')) {
        url = endpoint;
    } else {
        // Ensure proper joining of paths
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        url = `${API_BASE}${cleanEndpoint}`;
    }
    
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    const config = { ...options, headers };
    
    try {
        const response = await fetch(url, config);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `HTTP ${response.status}`);
        }
        
        if (response.status === 204) return null;
        return await response.json();
    } catch (error) {
        console.error(`API call failed for ${url}:`, error);
        throw error;
    }
}

// Global state
let usersList = [];
let selectedUserIds = {};
let currentTab = 'users';

// DOM elements
const usersTableBody = document.getElementById('usersTableBody');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectedCountSpan = document.getElementById('selectedCount');
const scheduleSelectedSpan = document.getElementById('scheduleSelectedCount');
const statTotal = document.getElementById('statTotalUsers');
const statPaid = document.getElementById('statPaid');
const statPending = document.getElementById('statPending');
const statFailed = document.getElementById('statFailed');
const statAmountSum = document.getElementById('statAmountSum');

// Helper: show temporary toast message
function showMessage(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.style.background = isError ? '#b91c1c' : '#0f172a';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Fetch all users and re-render table
async function fetchUsers() {
    try {
        const data = await apiCall('/users');
        // Handle different response structures
        const usersObj = data.users || data || {};
        usersList = Object.entries(usersObj).map(([id, user]) => ({ userId: id, ...user }));
        renderUsersTable();
        updateSelectedCounters();
        return usersList;
    } catch (error) {
        console.error('fetchUsers error', error);
        usersTableBody.innerHTML = `<tr><td colspan="6">Failed to load users: ${error.message}</td></tr>`;
        return [];
    }
}

// Render table with checkboxes
function renderUsersTable() {
    if (!usersList.length) {
        usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No users found. Add one above.</td></tr>';
        return;
    }
    
    let html = '';
    for (const user of usersList) {
        const isChecked = selectedUserIds[user.userId] ? 'checked' : '';
        const statusClass = user.paymentStatus === 'PAID' ? 'status-paid' : 
                           (user.paymentStatus === 'PENDING' ? 'status-pending' : 
                           (user.paymentStatus === 'FAILED' ? 'status-failed' : 'status-unpaid'));
        const statusText = user.paymentStatus || 'UNPAID';
        html += `
            <tr>
                <td class="checkbox-col"><input type="checkbox" class="user-checkbox" data-id="${user.userId}" ${isChecked}></td>
                <td><strong>${escapeHtml(user.fullName)}</strong></td>
                <td>${escapeHtml(user.phone)}</td>
                <td>${user.email ? escapeHtml(user.email) : '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td><button class="pay-single-btn" data-id="${user.userId}" data-name="${escapeHtml(user.fullName)}" style="background:#10b981; padding:6px 14px;">Pay Now</button></td>
            </tr>
        `;
    }
    usersTableBody.innerHTML = html;

    // attach event listeners for checkboxes
    document.querySelectorAll('.user-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const userId = cb.dataset.id;
            selectedUserIds[userId] = cb.checked;
            updateSelectedCounters();
            updateSelectAllCheckbox();
        });
    });
    
    // attach event listeners for pay buttons
    document.querySelectorAll('.pay-single-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = btn.dataset.id;
            const userName = btn.dataset.name;
            const amount = prompt(`Enter amount to pay ${userName} (RWF):`);
            if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
                showMessage('Invalid amount', true);
                return;
            }
            try {
                const result = await apiCall('/pay-user', {
                    method: 'POST',
                    body: JSON.stringify({ userId, amount: parseFloat(amount) })
                });
                showMessage(`✅ Payment initiated for ${userName}! Reference: ${result.referenceId || 'N/A'}`);
                await fetchStats();
                await fetchUsers(); // Refresh user list to update statuses
            } catch (err) {
                showMessage(`❌ Payment error: ${err.message}`, true);
            }
        });
    });
}

function updateSelectedCounters() {
    const selectedCount = Object.values(selectedUserIds).filter(v => v === true).length;
    if (selectedCountSpan) selectedCountSpan.innerText = `${selectedCount} selected`;
    if (scheduleSelectedSpan) scheduleSelectedSpan.innerText = selectedCount;
}

function updateSelectAllCheckbox() {
    if (!selectAllCheckbox) return;
    const allSelected = usersList.length > 0 && usersList.every(u => selectedUserIds[u.userId] === true);
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = !allSelected && Object.values(selectedUserIds).some(v => v === true);
}

function selectAllUsers(checked) {
    for (const user of usersList) {
        selectedUserIds[user.userId] = checked;
    }
    renderUsersTable();
    updateSelectedCounters();
}

// Fetch stats
async function fetchStats() {
    try {
        const data = await apiCall('/stats');
        const s = data.stats || data || {};
        if (statTotal) statTotal.innerText = s.totalUsers || 0;
        if (statPaid) statPaid.innerText = s.totalPaid || 0;
        if (statPending) statPending.innerText = s.totalPending || 0;
        if (statFailed) statFailed.innerText = s.totalFailed || 0;
        if (statAmountSum) statAmountSum.innerText = (s.totalAmountPaid || 0).toLocaleString();
        return s;
    } catch (err) {
        console.warn('Stats fetch error', err);
        return {};
    }
}

// Pay selected users
async function paySelectedUsers() {
    const selectedIds = Object.keys(selectedUserIds).filter(id => selectedUserIds[id]);
    if (selectedIds.length === 0) {
        showMessage('No users selected', true);
        return;
    }
    const amount = prompt(`Enter amount to pay ${selectedIds.length} selected user(s) (RWF):`);
    if (!amount || parseFloat(amount) <= 0) return;
    try {
        await apiCall('/pay-selected', {
            method: 'POST',
            body: JSON.stringify({ userIds: selectedIds, amount: parseFloat(amount) })
        });
        showMessage(`✅ Payments initiated for ${selectedIds.length} user(s)`);
        await fetchStats();
        await fetchUsers();
    } catch (err) {
        showMessage(`❌ Error: ${err.message}`, true);
    }
}

// Pay all users
async function payAllUsers() {
    const amount = prompt('Enter amount to pay EVERY user (RWF):');
    if (!amount || parseFloat(amount) <= 0) return;
    try {
        await apiCall('/pay-all', {
            method: 'POST',
            body: JSON.stringify({ amount: parseFloat(amount) })
        });
        showMessage(`✅ Bulk payment initiated for all users`);
        await fetchStats();
        await fetchUsers();
    } catch (err) {
        showMessage(`❌ Bulk payment error: ${err.message}`, true);
    }
}

// Export CSV
function exportCSV() {
    // Use relative path for download
    const exportUrl = `${API_BASE}/export/payments`;
    window.open(exportUrl, '_blank');
}

// Add user form
async function addUser(event) {
    event.preventDefault();
    const fullName = document.getElementById('userFullName').value.trim();
    const phone = document.getElementById('userPhone').value.trim();
    const email = document.getElementById('userEmail').value.trim() || undefined;
    
    if (!fullName || !phone) {
        showMessage('Full name and phone required', true);
        return;
    }
    
    try {
        await apiCall('/users', {
            method: 'POST',
            body: JSON.stringify({ fullName, phone, email })
        });
        showMessage('✅ User added successfully');
        document.getElementById('addUserForm').reset();
        await fetchUsers();
        await fetchStats();
    } catch (err) {
        showMessage(`❌ Add user error: ${err.message}`, true);
    }
}

// Schedule payment
async function schedulePayment() {
    const selectedIds = Object.keys(selectedUserIds).filter(id => selectedUserIds[id]);
    if (selectedIds.length === 0) {
        showMessage('No users selected for scheduling', true);
        return;
    }
    
    const dateTime = document.getElementById('scheduleDateTime')?.value;
    if (!dateTime) {
        showMessage('Please select a date and time', true);
        return;
    }
    
    const amount = prompt(`Enter amount to schedule for ${selectedIds.length} user(s) (RWF):`);
    if (!amount || parseFloat(amount) <= 0) return;
    
    try {
        await apiCall('/schedule-payment', {
            method: 'POST',
            body: JSON.stringify({ 
                userIds: selectedIds, 
                amount: parseFloat(amount),
                scheduledAt: dateTime
            })
        });
        showMessage(`✅ Payment scheduled for ${selectedIds.length} user(s) at ${new Date(dateTime).toLocaleString()}`);
    } catch (err) {
        showMessage(`❌ Schedule error: ${err.message}`, true);
    }
}

// Tab switching logic
function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    const targetTab = document.getElementById(`${tabId}Tab`);
    if (targetTab) targetTab.style.display = 'block';
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabId) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    
    if (tabId === 'schedule') {
        updateSelectedCounters();
    }
}

// Helper escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// initialization and event binding
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Admin panel loaded - using API_BASE:', API_BASE);
    
    // bind global actions
    const payAllBtn = document.getElementById('payAllBtn');
    const paySelectedBtn = document.getElementById('paySelectedBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const addUserForm = document.getElementById('addUserForm');
    const schedulePaymentBtn = document.getElementById('schedulePaymentBtn');
    
    if (payAllBtn) payAllBtn.addEventListener('click', payAllUsers);
    if (paySelectedBtn) paySelectedBtn.addEventListener('click', paySelectedUsers);
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (addUserForm) addUserForm.addEventListener('submit', addUser);
    if (schedulePaymentBtn) schedulePaymentBtn.addEventListener('click', schedulePayment);
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', (e) => selectAllUsers(e.target.checked));

    // tab listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // load data
    await fetchUsers();
    await fetchStats();
    switchTab('users');
    
    // periodic stat refresh every 30 seconds
    setInterval(() => {
        fetchStats().catch(e => console.log('Periodic stat refresh error:', e));
    }, 30000);
});