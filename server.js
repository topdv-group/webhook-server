const express = require('express');
const app = express();

// Middleware (IMPORTANT: must be before routes)
app.use(express.json());

// Health check route (browser test)
app.get('/', (req, res) => {
    res.send('Webhook server is running');
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const event = req.body;

    console.log('==============================');
    console.log('🔔 WEBHOOK RECEIVED');
    console.log(JSON.stringify(event, null, 2));
    console.log('==============================');

    // Flexible parsing (supports many payment APIs)
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

    console.log('📌 Parsed status:', status);
    console.log('📌 Parsed reference:', reference);

    // Safety check
    if (!status) {
        console.log('⚠️ No status found in webhook payload');
        return res.sendStatus(200);
    }

    // Business logic
    if (status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'completed') {
        console.log(`✅ Payment SUCCESS: ${reference}`);

        // TODO (future):
        // - update Firebase user balance
        // - save transaction record

    } else if (status === 'FAILED' || status === 'cancelled') {
        console.log(`❌ Payment FAILED: ${reference}`);
    } else {
        console.log(`⚠️ Unknown status: ${status}`);
    }

    // Always respond 200 to prevent retries
    res.sendStatus(200);
});

// Start server (Railway uses process.env.PORT)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
