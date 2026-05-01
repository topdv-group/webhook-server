// ========================
// CONFIGURATION - SAME DOMAIN (NO CORS)
// ========================

const API_BASE = '/api';

async function apiCall(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    
    const response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
    }
    
    return response.status === 204 ? null : await response.json();
}

let usersList = [];
let selectedUserIds = {};

// DOM elements
const usersTableBody = document.getElementById('usersTableBody');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectedCountSpan = document.getElementById('selectedCount');
const scheduleSelectedSpan = document.getElementById('scheduleSelectedCount');

function showMessage(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.style.background = isError ? '#b91c1c' : '#0f172a';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}

async function fetchUsers() {
    try {
        const data = await apiCall('/users');
        const usersObj = data.users || {};
        usersList = Object.entries(usersObj).map(([id, user]) => ({ userId: id, ...user }));
        renderUsersTable();
        updateSelectedCounters();
    } catch (error) {
        usersTableBody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    }
}

function renderUsersTable() {
    if (!usersList.length) {
        usersTableBody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
        return;
    }
    
    usersTableBody.innerHTML = usersList.map(user => `
        <tr>
            <td class="checkbox-col"><input type="checkbox" class="user-checkbox" data-id="${user.userId}" ${selectedUserIds[user.userId] ? 'checked' : ''}></td>
            <td><strong>${escapeHtml(user.fullName)}</strong></td>
            <td>${escapeHtml(user.phone)}</td>
            <td>${user.email ? escapeHtml(user.email) : '-'}</td>
            <td><span class="status-badge status-${(user.paymentStatus || 'UNPAID').toLowerCase()}">${user.paymentStatus || 'UNPAID'}</span></td>
            <td><button class="pay-single-btn" data-id="${user.userId}" data-name="${escapeHtml(user.fullName)}">Pay Now</button></td>
        </tr>
    `).join('');
    
    document.querySelectorAll('.user-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            selectedUserIds[cb.dataset.id] = cb.checked;
            updateSelectedCounters();
            updateSelectAllCheckbox();
        });
    });
    
    document.querySelectorAll('.pay-single-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const amount = prompt(`Enter amount for ${btn.dataset.name} (RWF):`);
            if (!amount || amount <= 0) return;
            try {
                await apiCall('/pay-user', { method: 'POST', body: JSON.stringify({ userId: btn.dataset.id, amount: parseFloat(amount) }) });
                showMessage(`✅ Payment initiated for ${btn.dataset.name}`);
                await fetchStats();
                await fetchUsers();
            } catch (err) {
                showMessage(`❌ Error: ${err.message}`, true);
            }
        });
    });
}

function updateSelectedCounters() {
    const count = Object.values(selectedUserIds).filter(v => v).length;
    if (selectedCountSpan) selectedCountSpan.innerText = `${count} selected`;
    if (scheduleSelectedSpan) scheduleSelectedSpan.innerText = count;
}

function updateSelectAllCheckbox() {
    if (!selectAllCheckbox) return;
    const allSelected = usersList.length > 0 && usersList.every(u => selectedUserIds[u.userId]);
    selectAllCheckbox.checked = allSelected;
}

function selectAllUsers(checked) {
    usersList.forEach(user => selectedUserIds[user.userId] = checked);
    renderUsersTable();
    updateSelectedCounters();
}

async function fetchStats() {
    try {
        const data = await apiCall('/stats');
        const s = data.stats || {};
        document.getElementById('statTotalUsers').innerText = s.totalUsers || 0;
        document.getElementById('statPaid').innerText = s.totalPaid || 0;
        document.getElementById('statPending').innerText = s.totalPending || 0;
        document.getElementById('statFailed').innerText = s.totalFailed || 0;
        document.getElementById('statAmountSum').innerText = (s.totalAmountPaid || 0).toLocaleString();
    } catch (err) {
        console.warn('Stats error:', err);
    }
}

async function paySelectedUsers() {
    const selectedIds = Object.keys(selectedUserIds).filter(id => selectedUserIds[id]);
    if (!selectedIds.length) return showMessage('No users selected', true);
    const amount = prompt(`Enter amount for ${selectedIds.length} user(s) (RWF):`);
    if (!amount || amount <= 0) return;
    try {
        await apiCall('/pay-selected', { method: 'POST', body: JSON.stringify({ userIds: selectedIds, amount: parseFloat(amount) }) });
        showMessage(`✅ Payments initiated for ${selectedIds.length} user(s)`);
        await fetchStats();
        await fetchUsers();
    } catch (err) {
        showMessage(`❌ Error: ${err.message}`, true);
    }
}

async function payAllUsers() {
    const amount = prompt('Enter amount for ALL users (RWF):');
    if (!amount || amount <= 0) return;
    try {
        await apiCall('/pay-all', { method: 'POST', body: JSON.stringify({ amount: parseFloat(amount) }) });
        showMessage('✅ Bulk payment initiated');
        await fetchStats();
        await fetchUsers();
    } catch (err) {
        showMessage(`❌ Error: ${err.message}`, true);
    }
}

function exportCSV() {
    window.open(`${API_BASE}/export/payments`, '_blank');
}

async function addUser(event) {
    event.preventDefault();
    const fullName = document.getElementById('userFullName').value.trim();
    const phone = document.getElementById('userPhone').value.trim();
    const email = document.getElementById('userEmail').value.trim() || undefined;
    
    if (!fullName || !phone) return showMessage('Name and phone required', true);
    
    try {
        await apiCall('/users', { method: 'POST', body: JSON.stringify({ fullName, phone, email }) });
        showMessage('✅ User added');
        document.getElementById('addUserForm').reset();
        await fetchUsers();
        await fetchStats();
    } catch (err) {
        showMessage(`❌ Error: ${err.message}`, true);
    }
}

async function schedulePayment() {
    const selectedIds = Object.keys(selectedUserIds).filter(id => selectedUserIds[id]);
    if (!selectedIds.length) return showMessage('No users selected', true);
    
    const dateTime = document.getElementById('scheduleDateTime')?.value;
    if (!dateTime) return showMessage('Select date/time', true);
    
    const amount = prompt(`Enter amount for ${selectedIds.length} user(s) (RWF):`);
    if (!amount || amount <= 0) return;
    
    try {
        await apiCall('/schedule-payment', { method: 'POST', body: JSON.stringify({ userIds: selectedIds, amount: parseFloat(amount), scheduledAt: dateTime }) });
        showMessage(`✅ Scheduled for ${selectedIds.length} user(s)`);
    } catch (err) {
        showMessage(`❌ Error: ${err.message}`, true);
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.getElementById(`${tabId}Tab`).style.display = 'block';
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('payAllBtn')?.addEventListener('click', payAllUsers);
    document.getElementById('paySelectedBtn')?.addEventListener('click', paySelectedUsers);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
    document.getElementById('addUserForm')?.addEventListener('submit', addUser);
    document.getElementById('schedulePaymentBtn')?.addEventListener('click', schedulePayment);
    selectAllCheckbox?.addEventListener('change', (e) => selectAllUsers(e.target.checked));
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    await fetchUsers();
    await fetchStats();
    switchTab('users');
    
    setInterval(() => fetchStats(), 30000);
});
