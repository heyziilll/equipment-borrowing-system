const cron = require("node-cron");
const db = require("../../config/db");
const { sendEmail } = require("./email");

async function updateOverdueAccounts() {
    await db.execute(
        `UPDATE borrow_transactions SET status = 'overdue'
         WHERE status = 'active' AND due_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    );
    await db.execute(
        `UPDATE users u SET account_hold = TRUE
         WHERE EXISTS (
           SELECT 1 FROM borrow_transactions bt
           WHERE bt.borrower_id = u.id AND bt.status = 'overdue'
         )`
    );
}

async function sendReminders() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return;
    const reminders = [
        { type: "due_24h", interval: "24 HOUR" },
        { type: "due_2h", interval: "2 HOUR" },
        { type: "overdue_alert", interval: null }
    ];
    for (const reminder of reminders) {
        const [rows] = reminder.type === "overdue_alert"
            ? await db.execute(
                `SELECT bt.id, bt.borrower_id, bt.due_at, u.email, e.name
                 FROM borrow_transactions bt JOIN users u ON u.id = bt.borrower_id
                 JOIN equipment e ON e.id = bt.equipment_id
                 WHERE bt.status = 'overdue' AND NOT EXISTS (
                   SELECT 1 FROM notifications n WHERE n.user_id = bt.borrower_id
                     AND n.type = ? AND n.reference_id = CAST(bt.id AS CHAR) AND n.sent_at IS NOT NULL
                 )`,
                [reminder.type]
            )
            : await db.execute(
                `SELECT bt.id, bt.borrower_id, bt.due_at, u.email, e.name
                 FROM borrow_transactions bt JOIN users u ON u.id = bt.borrower_id
                 JOIN equipment e ON e.id = bt.equipment_id
                 WHERE bt.status = 'active' AND bt.due_at BETWEEN
                   DATE_SUB(DATE_ADD(NOW(), INTERVAL ${reminder.interval}), INTERVAL 1 MINUTE) AND
                   DATE_ADD(NOW(), INTERVAL ${reminder.interval})
                   AND NOT EXISTS (
                     SELECT 1 FROM notifications n WHERE n.user_id = bt.borrower_id
                       AND n.type = ? AND n.reference_id = CAST(bt.id AS CHAR) AND n.sent_at IS NOT NULL
                   )`,
                [reminder.type]
            );
        for (const row of rows) {
            const subject = reminder.type === "overdue_alert" ? "EBS overdue equipment alert" : "EBS return reminder";
            const body = reminder.type === "overdue_alert"
                ? `${row.name} is overdue. Return it to the equipment counter to clear your account hold.`
                : `${row.name} is due at ${new Date(row.due_at).toISOString()}.`;
            await db.execute(
                `INSERT INTO notifications (user_id, type, subject, body, reference_id)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
                [row.borrower_id, reminder.type, subject, body, String(row.id)]
            );
            const sent = await sendEmail({ to: row.email, subject, text: body });
            if (sent) {
                await db.execute(
                    `UPDATE notifications SET sent_at = NOW()
                     WHERE user_id = ? AND type = ? AND reference_id = ?`,
                    [row.borrower_id, reminder.type, String(row.id)]
                );
            }
        }
    }
}

function startScheduler() {
    cron.schedule("* * * * *", async () => {
        try {
            await updateOverdueAccounts();
            await sendReminders();
        } catch (error) {
            console.error("EBS reminder scheduler failed:", error.message);
        }
    });
}

module.exports = { startScheduler };
