// server.js - SINGLE DOMAIN PRODUCTION VERSION (PUBLIC FOLDER)

const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

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

app.use(express.json());

// ========================
// CONFIG
// ========================
const PAYMENT_API_URL = process.env.PAYMENT_BASE_URL;
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY;

// ========================
// FRONTEND (PUBLIC FOLDER)
// ========================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========================
// HELPERS
// ========================
function generateReferenceId() {
    return 'PAY_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
}

// ========================
// ROUTER (THIS IS WHAT YOU ASKED FOR)
// ========================
const router = express.Router();

// ========================
// USERS
// ========================
router.post('/users', async (req, res) => {
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

        res.status(201).json({
            success: true,
            userId,
            ...userData
        });

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/users', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};

        res.json({
            success: true,
            count: Object.keys(users).length,
            users
        });

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// PAYMENT
// ========================
router.post('/pay-user', async (req, res) => {
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

        const apiResponse = await axios.post(PAYMENT_API_URL, {
            amount,
            currency: "RWF",
            customerPhone: user.phone,
            externalId: referenceId
        }, {
            headers: {
                Authorization: `Bearer ${PAYMENT_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

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
            paymentId,
            referenceId,
            status: 'PROCESSING'
        });

    } catch (error) {
        res.status(500).json({
            error: 'Payment request failed',
            details: error.response?.data || error.message
        });
    }
});

// ========================
// STATS
// ========================
router.get('/stats', async (req, res) => {
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// WEBHOOK
// ========================
router.post('/webhook', async (req, res) => {
    res.status(200).json({ received: true });

    const { referenceId, status, transactionId } = req.body;
    if (!referenceId || !status) return;

    try {
        const snap = await db.ref('payments')
            .orderByChild('referenceId')
            .equalTo(referenceId)
            .once('value');

        if (!snap.exists()) return;

        const paymentId = Object.keys(snap.val())[0];
        const payment = snap.val()[paymentId];

        await db.ref(`payments/${paymentId}`).update({
            status,
            transactionId: transactionId || null,
            updatedAt: Date.now()
        });

        const userUpdate = {
            paymentStatus: status === 'SUCCESS' ? 'PAID' : 'FAILED'
        };

        if (status === 'SUCCESS') {
            userUpdate.lastPaidAt = Date.now();
        }

        await db.ref(`users/${payment.userId}`).update(userUpdate);

    } catch (error) {
        console.error(error);
    }
});

// ========================
// HEALTH
// ========================
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// ========================
// APPLY ROUTER
// ========================
app.use('/api', router);

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
    console.log("🌐 Public folder + API router enabled");
});
