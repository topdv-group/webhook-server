const express = require('express');
const admin = require('firebase-admin');

const app = express(); // ✅ FIRST create app

// ========================
// Firebase Initialization
// ========================
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://tumirarwanda-add46-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database(); // ✅ db defined BEFORE use

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
// TEST ROUTE (correct position)
// ========================
app.get('/test-save', async (req, res) => {
    try {
        await db.ref('test').set({
            message: "Railway test",
            time: Date.now()
        });

        console.log("✅ Firebase write SUCCESS");
        res.send("Saved to Firebase");
    } catch (error) {
        console.error("❌ Firebase error:", error);
        res.status(500).send("Error");
    }
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

    if (!status || !reference) {
        console.log('⚠️ Missing required fields');
        return res.sendStatus(200);
    }

    try {
        await db.ref('transactions/' + reference).set({
            phone: phone || 'UNKNOWN',
            amount: Number(amount) || 0,
            status: status,
            date: Date.now()
        });

        console.log('💾 Transaction saved:', reference);
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