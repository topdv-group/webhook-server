const express = require('express');
const admin = require('firebase-admin');

const app = express();

// ========================
// Firebase Initialization
// ========================
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://tumirarwanda-add46-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// ========================
// Middleware
// ========================
app.use(express.json());

// ========================
// Health check route
// ========================
app.get('/', (req, res) => {
    res.send('Webhook server is running');
});

// ========================
// Webhook endpoint
// ========================
app.post('/webhook', async (req, res) => {
    const event = req.body;

    console.log('==============================');
    console.log('🔔 WEBHOOK RECEIVED');
    console.log(JSON.stringify(event, null, 2));
    console.log('==============================');

    // Flexible parsing
    const status =
        event?.status ||
        event?.data?.status ||
        event?.payment_status ||
        event?.transaction_status;

    const reference =
        event?.reference ||
        event?.data?.reference ||
        event?.transaction_id ||
        event?.id;

    const phone =
        event?.phone ||
        event?.msisdn ||
        event?.customer_phone;

    const amount =
        event?.amount ||
        event?.value ||
        event?.total_amount;

    console.log('📌 Parsed status:', status);
    console.log('📌 Parsed reference:', reference);
    console.log('📌 Parsed phone:', phone);
    console.log('📌 Parsed amount:', amount);

    // Safety check
    if (!status || !reference) {
        console.log('⚠️ Missing required fields');
        return res.sendStatus(200);
    }

    try {
        // Save transaction in Realtime Database
        await db.ref('transactions/' + reference).set({
            phone: phone || 'UNKNOWN',
            amount: amount || 0,
            status: status,
            date: Date.now()
        });

        console.log('💾 Transaction saved:', reference);

        // Business logic
        if (status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'completed') {
            console.log(`✅ Payment SUCCESS: ${reference}`);
        } else if (status === 'FAILED' || status === 'cancelled') {
            console.log(`❌ Payment FAILED: ${reference}`);
        } else {
            console.log(`⚠️ Unknown status: ${status}`);
        }

        res.sendStatus(200);

    } catch (error) {
        console.error('❌ Firebase error:', error);
        res.sendStatus(500);
    }
});

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
