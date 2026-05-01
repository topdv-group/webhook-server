// server.js - MVP WITH REAL PAYMENTS (PAWAPAY)

const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios'); // ✅ ADDED

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

// ========================
// Config
// ========================
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'change-me-in-production';

const PAYMENT_API_URL = process.env.PAYMENT_BASE_URL;
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY;

// ========================
// Auth
// ========================
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
// USER ROUTES
// ========================
app.post('/users', authAdmin, async (req, res) => {
    try {
        const { fullName, phone, email } = req.body;

        if (!fullName || !phone) {
            return res.status(400).json({ error: 'fullName and phone required' });
        }

        const existing = await db.ref('users')
            .orderByChild('phone')
            .equalTo(phone)
            .once('value');

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

app.get('/users', authAdmin, async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        res.json({ success: true, count: Object.keys(users).length, users });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// PAYMENT ROUTES
// ========================
app.post('/pay-user', authAdmin, async (req, res) => {
    try {
        const { userId, amount } = req.body;

        if (!userId || !amount || amount <= 0) {
            return res.status(400).json({ error: 'userId and positive amount required' });
        }

        const userSnap = await db.ref(`users/${userId}`).once('value');

        if (!userSnap.exists()) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userSnap.val();
        const referenceId = generateReferenceId();

        // ========================
        // 🔥 CALL PAWAPAY
        // ========================
        let apiResponse;

        try {
            apiResponse = await axios.post(PAYMENT_API_URL, {
                amount: amount,
                currency: "RWF",
                customerPhone: user.phone,
                externalId: referenceId
            }, {
                headers: {
                    Authorization: `Bearer ${PAYMENT_API_KEY}`,
                    "Content-Type": "application/json"
                }
            });
        } catch (apiError) {
            console.error('Payment API error:', apiError.response?.data || apiError.message);

            return res.status(500).json({
                error: 'Payment request failed',
                details: apiError.response?.data || apiError.message
            });
        }

        // ========================
        // SAVE PAYMENT
        // ========================
        const paymentId = db.ref('payments').push().key;

        await db.ref(`payments/${paymentId}`).set({
            userId,
            amount: Number(amount),
            status: 'PROCESSING',
            referenceId,
            provider: 'pawapay',
            providerResponse: apiResponse.data,
            createdAt: Date.now()
        });

        res.status(201).json({
            success: true,
            message: 'Payment request sent to user phone',
            paymentId,
            referenceId,
            status: 'PROCESSING'
        });

    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// WEBHOOK
// ========================
app.post('/webhook', async (req, res) => {
    res.status(200).json({ received: true });

    const { referenceId, status, transactionId } = req.body;

    if (!referenceId || !status) return;

    try {
        const paymentsSnap = await db.ref('payments')
            .orderByChild('referenceId')
            .equalTo(referenceId)
            .once('value');

        if (!paymentsSnap.exists()) return;

        const paymentId = Object.keys(paymentsSnap.val())[0];
        const payment = paymentsSnap.val()[paymentId];

        await db.ref(`payments/${paymentId}`).update({
            status,
            updatedAt: Date.now(),
            transactionId: transactionId || null
        });

        const userUpdate = {
            paymentStatus: status === 'SUCCESS' ? 'PAID' : 'FAILED'
        };

        if (status === 'SUCCESS') {
            userUpdate.lastPaidAt = Date.now();
        }

        await db.ref(`users/${payment.userId}`).update(userUpdate);

        console.log(`Webhook: ${referenceId} -> ${status}`);

    } catch (error) {
        console.error('Webhook error:', error);
    }
});

// ========================
// HEALTH
// ========================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// ========================
// START
// ========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
