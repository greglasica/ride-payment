require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const Square = require('square');
const path = require('path');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const twilioNumber = process.env.TWILIO_NUMBER;
const squareClient = new Square.Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox'
});
const squareAppId = process.env.SQUARE_APP_ID;
const squareLocationId = process.env.SQUARE_LOCATION_ID;

// ... rest of your server.js code ...

// SMS endpoint
app.post('/api/send-sms', (req, res) => {
    const { to, message } = req.body;
    twilioClient.messages.create({
        body: message,
        from: twilioNumber,
        to: to
    }).then(() => res.json({ status: 'success' }))
      .catch(err => res.status(500).json({ status: 'error', message: err.message }));
});

// Payment endpoint
app.post('/api/process-payment', async (req, res) => {
    const { amount, token } = req.body;
    try {
        const response = await squareClient.paymentsApi.createPayment({
            sourceId: token,
            amountMoney: { amount: Math.round(amount * 100), currency: 'USD' },
            idempotencyKey: Math.random().toString(36).substring(2),
            locationId: squareLocationId
        });
        res.json({ status: 'success', paymentId: response.result.payment.id });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Serve index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Expose Square App ID (optional, for client-side use in script.js)
app.get('/config', (req, res) => {
    res.json({ squareAppId: squareAppId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
