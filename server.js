const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Webhook server is running');
});

app.post('/webhook', (req, res) => {
    console.log('==== WEBHOOK RECEIVED ====');
    console.log(req.body);

    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('Server running on port', PORT);
});
