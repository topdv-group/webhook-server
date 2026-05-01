// server.js - Production Ready MVP
const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

// ========================
// Firebase Initialization
// ========================

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.DB_URL
});

const db = admin.database();

// ========================
// Middleware
// ========================
app.use(express.json());

// Simple API Key Protection
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'change-me-in-production';

function authAdmin(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ========================
// Helpers
// ========================

function generateReferenceId() {
    return 'PAY_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
}

// ========================
// USER ROUTES (Admin only)
// ========================

// POST /users - Register employee
app.post('/users', authAdmin, async (req, res) => {
    try {
        const { fullName, phone, email } = req.body;
        
        if (!fullName || !phone) {
            return res.status(400).json({ error: 'fullName and phone required' });
        }
        
        // Check for duplicate phone
        const existing = await db.ref('users').orderByChild('phone').equalTo(phone).once('value');
        if (existing.exists()) {
            return res.status(409).json({ error: 'Phone number already registered' });
        }
        
        const userId = db.ref('users').push().key;
        const userData = {
            fullName: fullName.trim(),
            phone: phone.trim(),
            email: email || null,
            role: 'employee',
            createdAt: Date.now(),
            paymentStatus: 'UNPAID',
            lastPaidAt: null
        };
        
        await db.ref(`users/${userId}`).set(userData);
        res.status(201).json({ success: true, userId, ...userData });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /users - Get all users
app.get('/users', authAdmin, async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        res.json({ success: true, count: Object.keys(users).length, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// PAYMENT ROUTES (Admin only)
// ========================

// POST /pay-user - Single payment
app.post('/pay-user', authAdmin, async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        if (!userId || !amount || amount <= 0) {
            return res.status(400).json({ error: 'userId and positive amount required' });
        }
        
        // Verify user exists
        const userSnap = await db.ref(`users/${userId}`).once('value');
        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const referenceId = generateReferenceId();
        const paymentId = db.ref('payments').push().key;
        const paymentData = {
            userId,
            amount: Number(amount),
            status: 'PENDING',
            referenceId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        await db.ref(`payments/${paymentId}`).set(paymentData);
        
        res.status(201).json({
            success: true,
            message: 'Payment initiated (PENDING)',
            paymentId,
            referenceId,
            status: 'PENDING'
        });
        
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /pay-all - Bulk payment for all users
app.post('/pay-all', authAdmin, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Positive amount required' });
        }
        
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val();
        
        if (!users || Object.keys(users).length === 0) {
            return res.status(404).json({ error: 'No users found' });
        }
        
        const payments = [];
        const updates = {};
        
        for (const userId of Object.keys(users)) {
            const referenceId = generateReferenceId();
            const paymentId = db.ref('payments').push().key;
            const paymentData = {
                userId,
                amount: Number(amount),
                status: 'PENDING',
                referenceId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            updates[`payments/${paymentId}`] = paymentData;
            payments.push({ paymentId, userId, referenceId });
        }
        
        // Single update to Firebase (faster than loop)
        await db.ref().update(updates);
        
        res.status(201).json({
            success: true,
            message: `Bulk payment initiated for ${payments.length} users (PENDING)`,
            total: payments.length,
            payments
        });
        
    } catch (error) {
        console.error('Error in bulk payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// STATS ENDPOINT (Admin only)
// ========================

app.get('/stats', authAdmin, async (req, res) => {
    try {
        const [usersSnap, paymentsSnap] = await Promise.all([
            db.ref('users').once('value'),
            db.ref('payments').once('value')
        ]);
        
        const users = usersSnap.val() || {};
        const payments = paymentsSnap.val() || {};
        
        let totalPaid = 0;
        let totalPending = 0;
        let totalFailed = 0;
        let totalAmountSuccess = 0;
        
        for (const user of Object.values(users)) {
            if (user.paymentStatus === 'PAID') totalPaid++;
            else if (user.paymentStatus === 'PENDING') totalPending++;
            else if (user.paymentStatus === 'FAILED') totalFailed++;
        }
        
        for (const payment of Object.values(payments)) {
            if (payment.status === 'SUCCESS') {
                totalAmountSuccess += payment.amount;
            }
        }
        
        res.json({
            success: true,
            stats: {
                totalUsers: Object.keys(users).length,
                totalPaid,
                totalPending,
                totalFailed,
                totalAmountPaid: totalAmountSuccess
            }
        });
        
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// WEBHOOK (Public)
// Always returns 200, updates Firebase in background
// ========================

app.post('/webhook', async (req, res) => {
    // 1. Immediately respond to prevent timeout
    res.status(200).json({ received: true });
    
    // 2. Process webhook asynchronously
    const { referenceId, status, transactionId } = req.body;
    
    if (!referenceId || !status) {
        console.warn('Webhook missing referenceId or status');
        return;
    }
    
    if (status !== 'SUCCESS' && status !== 'FAILED') {
        console.warn(`Webhook unknown status: ${status}`);
        return;
    }
    
    try {
        // Find payment by referenceId
        const paymentsSnap = await db.ref('payments')
            .orderByChild('referenceId')
            .equalTo(referenceId)
            .once('value');
        
        if (!paymentsSnap.exists()) {
            console.warn(`No payment found for referenceId: ${referenceId}`);
            // Store in transactions log for audit
            await db.ref(`transactions/${referenceId}`).set({
                referenceId,
                status,
                transactionId,
                receivedAt: Date.now(),
                error: 'No matching payment'
            });
            return;
        }
        
        const paymentId = Object.keys(paymentsSnap.val())[0];
        const payment = paymentsSnap.val()[paymentId];
        
        // Update payment status
        await db.ref(`payments/${paymentId}`).update({
            status: status,
            updatedAt: Date.now(),
            transactionId: transactionId || null,
            webhookReceivedAt: Date.now()
        });
        
        // Update user paymentStatus
        const userPaymentStatus = status === 'SUCCESS' ? 'PAID' : 'FAILED';
        const userUpdate = { paymentStatus: userPaymentStatus };
        if (status === 'SUCCESS') {
            userUpdate.lastPaidAt = Date.now();
        }
        
        await db.ref(`users/${payment.userId}`).update(userUpdate);
        
        console.log(`✅ Webhook processed: ${referenceId} -> ${status}`);
        
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Error logged but not sent to client (already responded)
    }
});

// ========================
// Health check (public)
// ========================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// ========================
// Start Server
// ========================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 Admin API Key: ${ADMIN_API_KEY}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
});
