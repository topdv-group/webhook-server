const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

// ========================
// Firebase Initialization (FIXED FOR RAILWAY)
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
// Helper Functions
// ========================

/**
 * Generate unique reference ID
 */
function generateReferenceId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate unique batch ID
 */
function generateBatchId() {
    return 'batch_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Create payment record
 */
async function createPaymentRecord(userId, amount, referenceId, batchId = null, paymentType = 'single') {
    const paymentId = db.ref('payments').push().key;
    const paymentData = {
        userId,
        amount: Number(amount),
        referenceId,
        status: 'PENDING',
        paymentType,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    if (batchId) {
        paymentData.batchId = batchId;
    }
    
    await db.ref(`payments/${paymentId}`).set(paymentData);
    
    return {
        paymentId,
        ...paymentData
    };
}

// ========================
// Health check route
// ========================
app.get('/', (req, res) => {
    res.send('Webhook server is running');
});

// ========================
// TEST ROUTE
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
// USER REGISTRATION SYSTEM
// ========================

/**
 * POST /users - Create a new user
 * Body: { fullName, phone }
 */
app.post('/users', async (req, res) => {
    try {
        const { fullName, phone } = req.body;
        
        // Validation
        if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
            return res.status(400).json({ 
                error: 'fullName is required and must be a non-empty string' 
            });
        }
        
        if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
            return res.status(400).json({ 
                error: 'phone is required and must be a non-empty string' 
            });
        }
        
        // Check if phone already exists
        const existingUsers = await db.ref('users')
            .orderByChild('phone')
            .equalTo(phone.trim())
            .once('value');
        
        if (existingUsers.exists()) {
            return res.status(409).json({ 
                error: 'User with this phone number already exists' 
            });
        }
        
        // Generate unique user ID
        const userId = db.ref('users').push().key;
        
        const userData = {
            fullName: fullName.trim(),
            phone: phone.trim(),
            createdAt: Date.now()
        };
        
        await db.ref(`users/${userId}`).set(userData);
        
        res.status(201).json({
            success: true,
            userId,
            ...userData
        });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /users - Get all users
 */
app.get('/users', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        
        res.json({
            success: true,
            count: Object.keys(users).length,
            users
        });
        
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// SINGLE PAYMENT INITIATION
// ========================

/**
 * POST /pay-user - Create payment for a specific user
 * Body: { userId, amount }
 */
app.post('/pay-user', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        // Validation
        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({ error: 'userId is required' });
        }
        
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }
        
        // Verify user exists
        const userSnapshot = await db.ref(`users/${userId}`).once('value');
        if (!userSnapshot.exists()) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Generate reference ID and create payment record
        const referenceId = generateReferenceId();
        const paymentRecord = await createPaymentRecord(userId, amount, referenceId, null, 'single');
        
        res.status(201).json({
            success: true,
            message: 'Payment initiated successfully',
            payment: paymentRecord
        });
        
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// BULK PAYMENT SYSTEM
// ========================

/**
 * POST /pay-all - Create payments for all users
 * Body: { amount }
 */
app.post('/pay-all', async (req, res) => {
    try {
        const { amount } = req.body;
        
        // Validation
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }
        
        // Fetch all users
        const usersSnapshot = await db.ref('users').once('value');
        const users = usersSnapshot.val();
        
        if (!users || Object.keys(users).length === 0) {
            return res.status(404).json({ error: 'No users found to process payments' });
        }
        
        // Generate batch ID
        const batchId = generateBatchId();
        const userIds = Object.keys(users);
        const payments = [];
        const errors = [];
        
        // Bulk payment record
        const bulkPaymentRecord = {
            batchId,
            amount: Number(amount),
            totalUsers: userIds.length,
            status: 'PROCESSING',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        await db.ref(`payments/batches/${batchId}`).set(bulkPaymentRecord);
        
        // Loop through users and create payment entries
        for (const userId of userIds) {
            try {
                const referenceId = generateReferenceId();
                const paymentRecord = await createPaymentRecord(
                    userId, 
                    amount, 
                    referenceId, 
                    batchId, 
                    'bulk'
                );
                
                payments.push({
                    userId,
                    ...paymentRecord
                });
                
            } catch (error) {
                console.error(`Error creating payment for user ${userId}:`, error);
                errors.push({
                    userId,
                    error: error.message
                });
            }
        }
        
        // Update bulk payment status
        const finalStatus = errors.length === 0 ? 'COMPLETED' : 'PARTIAL';
        await db.ref(`payments/batches/${batchId}`).update({
            status: finalStatus,
            successfulPayments: payments.length,
            failedPayments: errors.length,
            completedAt: Date.now(),
            updatedAt: Date.now()
        });
        
        res.status(201).json({
            success: true,
            message: 'Bulk payment processed',
            batchId,
            totalUsers: userIds.length,
            successfulPayments: payments.length,
            failedPayments: errors.length,
            payments,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Error processing bulk payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// ADDITIONAL UTILITY ENDPOINTS
// ========================

/**
 * GET /payments/user/:userId - Get all payments for a specific user
 */
app.get('/payments/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const paymentsSnapshot = await db.ref('payments')
            .orderByChild('userId')
            .equalTo(userId)
            .once('value');
        
        const payments = paymentsSnapshot.val() || {};
        
        res.json({
            success: true,
            userId,
            count: Object.keys(payments).length,
            payments
        });
        
    } catch (error) {
        console.error('Error fetching user payments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /payments/batch/:batchId - Get bulk payment details
 */
app.get('/payments/batch/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        
        const batchSnapshot = await db.ref(`payments/batches/${batchId}`).once('value');
        const batch = batchSnapshot.val();
        
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        
        // Get all payments in this batch
        const paymentsSnapshot = await db.ref('payments')
            .orderByChild('batchId')
            .equalTo(batchId)
            .once('value');
        
        const payments = paymentsSnapshot.val() || {};
        
        res.json({
            success: true,
            batch,
            payments
        });
        
    } catch (error) {
        console.error('Error fetching batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /transactions/:reference - Get transaction by reference
 */
app.get('/transactions/:reference', async (req, res) => {
    try {
        const { reference } = req.params;
        
        const transactionSnapshot = await db.ref(`transactions/${reference}`).once('value');
        const transaction = transactionSnapshot.val();
        
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        res.json({
            success: true,
            reference,
            transaction
        });
        
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// UNIFIED WEBHOOK ENDPOINT
// ========================

app.post('/webhook', async (req, res) => {
    const event = req.body;

    console.log('==============================');
    console.log('🔔 WEBHOOK RECEIVED');
    console.log(JSON.stringify(event, null, 2));
    console.log('==============================');

    // Extract data from webhook with multiple fallbacks
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

    // Always return 200 to prevent webhook retries
    if (!status || !reference) {
        console.log('⚠️ Missing required fields in webhook');
        return res.sendStatus(200);
    }

    try {
        // Save transaction to Firebase
        await db.ref('transactions/' + reference).set({
            phone: phone || 'UNKNOWN',
            amount: Number(amount) || 0,
            status: status,
            date: Date.now(),
            rawWebhook: event
        });

        console.log('💾 Transaction saved:', reference);
        
        // Update corresponding payment record if referenceId matches
        try {
            const paymentsSnapshot = await db.ref('payments')
                .orderByChild('referenceId')
                .equalTo(reference)
                .once('value');
            
            if (paymentsSnapshot.exists()) {
                const payments = paymentsSnapshot.val();
                const paymentId = Object.keys(payments)[0];
                
                await db.ref(`payments/${paymentId}`).update({
                    status: status.toUpperCase(),
                    transactionStatus: status,
                    updatedAt: Date.now(),
                    webhookReceivedAt: Date.now()
                });
                console.log('🔄 Updated payment record:', paymentId);
            } else {
                console.log('⚠️ No matching payment record found for reference:', reference);
            }
        } catch (paymentError) {
            // Don't fail the webhook if payment update fails
            console.error('Error updating payment record:', paymentError);
        }
        
        res.sendStatus(200);

    } catch (error) {
        console.error('❌ Firebase error:', error);
        // Always return 200 to prevent webhook retries even on error
        res.sendStatus(200);
    }
});

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});