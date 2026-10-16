const nodemailer = require("nodemailer");

let transport;
function getTransport() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        return null;
    }
    if (!transport) {
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        });
    }
    return transport;
}

async function sendEmail({ to, subject, text }) {
    const mailer = getTransport();
    if (!mailer) {
        console.warn(`Email not sent because SMTP is not configured (type: ${subject}).`);
        return false;
    }
    await mailer.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text
    });
    return true;
}

module.exports = { sendEmail };
