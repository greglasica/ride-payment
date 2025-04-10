require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const Square = require('square');
const nodemailer = require('nodemailer'); // Keep this one
const path = require('path');
const app = express();

app.get('/config', (req, res) => {
    const squareAppId = process.env.SQUARE_APP_ID;
    const squareLocationId = process.env.SQUARE_LOCATION_ID;
    if (!squareAppId || !squareLocationId) {
        console.error('Missing Square credentials in .env');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    res.json({
        squareAppId: squareAppId,
        squareLocationId: squareLocationId
    });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/public', express.static(path.join(__dirname, 'public'))); // Add this if not present

const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const twilioNumber = process.env.TWILIO_NUMBER;
const squareClient = new Square.Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox'
});
const squareAppId = process.env.SQUARE_APP_ID;
const squareLocationId = process.env.SQUARE_LOCATION_ID;

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587, // TLS
    secure: false, // Use TLS, not SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // Optional: bypass strict SSL if needed
    }
});

// Routes...
app.post('/api/send-sms', (req, res) => {
    const { to, message } = req.body;
    twilioClient.messages.create({
        body: message,
        from: twilioNumber,
        to: to
    }).then(() => {
        console.log('SMS sent successfully to:', to);
        res.json({ status: 'success' });
    }).catch(err => {
        console.error('SMS send error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    });
});

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/send-email', async (req, res) => {
    const { adminSubject, adminBody, driverSubject, driverBody, driverEmail } = req.body;

    const adminMailOptions = {
        from: process.env.EMAIL_USER,
        to: 'minndriveairport@gmail.com',
        subject: adminSubject,
        text: adminBody
    };

    const driverMailOptions = {
        from: process.env.EMAIL_USER,
        to: driverEmail,
        subject: driverSubject,
        text: driverBody
    };

    try {
        await transporter.sendMail(adminMailOptions);
        console.log('Admin email sent');
        await transporter.sendMail(driverMailOptions);
        console.log('Driver email sent');
        res.json({ status: 'success' });
    } catch (error) {
        console.error('Email send error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));