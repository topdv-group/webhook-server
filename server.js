const express = require('express');
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Health check (for browser test)
app.get('/', (req, res) => {
    res.send('Webhook server is running');
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const event = req.body;

    console.log('==== WEBHOOK RECEIVED ====');
    console.log(JSON.stringify(event, null, 2));

    try {
        // Example: adjust depending on your payment API
        const status = event.status || event.data?.status;
        const reference = event.reference || event.data?.reference;

        if (status === 'SUCCESSFUL' || status === 'SUCCESS') {
            console.log(`✅ Payment successful: ${reference}`);

            // TODO:
            // - update Firebase user balance
            // - mark transaction as completed

        } else if (status === 'FAILED') {
            console.log(`❌ Payment failed: ${reference}`);
        } else {
            console.log('⚠️ Unknown status:', status);
        }

        // Always respond 200
        res.sendStatus(200);

    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

// IMPORTANT: use dynamic port for Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
