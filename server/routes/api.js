const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const multer = require("multer");
const { z } = require("zod");
const db = require("../../config/db");
const { authenticate, allow, allowPasswordUpdate } = require("../middleware/auth");
const { sendEmail } = require("../services/email");
const { audit } = require("../services/audit");

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter(req, file, callback) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
            return callback(new Error("Only JPEG, PNG, and WebP images are accepted."));
        }
        return callback(null, true);
    }
});
const borrowerRoles = ["student", "faculty"];
const staffRoles = ["custodian", "administrator"];
const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password cannot exceed bcrypt's 72-byte input limit."
);
const authRequired = [authenticate, allow()];
const passwordUpdateAllowed = [authenticate, allowPasswordUpdate()];
const staffOnly = [authenticate, allow(...staffRoles)];
const adminOnly = [authenticate, allow("administrator")];

function parse(schema, input) {
    return schema.parse(input);
}

function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function deliverEmail(message) {
    try {
        return await sendEmail(message);
    } catch (error) {
        console.error(`Email delivery failed (${message.subject}):`, error.message);
        return false;
    }
}

function detectImageMime(buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return null;
}

function isCampusServiceTime(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: process.env.CAMPUS_TIMEZONE || "Asia/Manila",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const minuteOfDay = Number(values.hour) * 60 + Number(values.minute);
    return values.weekday !== "Sun" && minuteOfDay >= 450 && minuteOfDay <= 1050;
}

function signAccessToken(user) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error("JWT_SECRET must contain at least 32 characters.");
    }
    return jwt.sign(
        { email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { subject: String(user.id), expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
    );
}

async function createActionToken(userId, purpose) {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
        `INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
        [userId, tokenHash(token), purpose]
    );
    return token;
}

router.post("/auth/register", async (req, res) => {
    const registrationSchema = z.object({
        role: z.enum(["student", "faculty"]).default("student"),
        fullName: z.string().trim().min(2).max(160),
        studentId: z.string().trim().min(3).max(40).optional(),
        email: emailSchema,
        program: z.string().trim().min(2).max(120).optional(),
        password: passwordSchema
    }).strict().superRefine((input, context) => {
        if (input.role === "student" && !input.studentId) {
            context.addIssue({ code: "custom", path: ["studentId"], message: "Student ID is required for student accounts." });
        }
        if (input.role === "student" && !input.program) {
            context.addIssue({ code: "custom", path: ["program"], message: "Program is required for student accounts." });
        }
    });
    const input = parse(registrationSchema, req.body);
    const domain = process.env.INSTITUTIONAL_EMAIL_DOMAIN;
    if (domain && input.email.split("@")[1] !== domain.toLowerCase()) {
        return res.status(400).json({ error: "Use your institutional email address." });
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const [roles] = await db.execute("SELECT id FROM roles WHERE name = ?", [input.role]);
    const [result] = await db.execute(
        `INSERT INTO users (role_id, student_id, full_name, email, program, password_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [roles[0].id, input.studentId || null, input.fullName, input.email, input.program || null, passwordHash]
    );
    const token = await createActionToken(result.insertId, "verify_email");
    const verifyUrl = `${process.env.APP_BASE_URL || "http://localhost:5173"}/verify-email?token=${token}`;
    const emailSent = await deliverEmail({
        to: input.email,
        subject: "Verify your EBS account",
        text: `Verify your institutional email within 30 minutes: ${verifyUrl}`
    });
    res.status(201).json({
        message: emailSent
            ? "Account created. Check your institutional email to verify it."
            : "Account created, but the verification email could not be delivered. Ask an administrator to check SMTP configuration.",
        emailSent,
        verificationLink: process.env.NODE_ENV === "production" ? undefined : verifyUrl
    });
});

router.post("/auth/verify-email", async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(32).max(256) }).strict(), req.body);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [tokens] = await connection.execute(
            `SELECT id, user_id FROM auth_tokens
             WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL
               AND expires_at > NOW() FOR UPDATE`,
            [tokenHash(token)]
        );
        if (!tokens.length) {
            await connection.rollback();
            return res.status(400).json({ error: "Verification link is invalid or expired." });
        }
        await connection.execute("UPDATE users SET email_verified_at = NOW() WHERE id = ?", [tokens[0].user_id]);
        await connection.execute("UPDATE auth_tokens SET used_at = NOW() WHERE id = ?", [tokens[0].id]);
        await connection.commit();
        res.json({ message: "Email verified. You can now sign in." });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.post("/auth/login", async (req, res) => {
    const input = parse(z.object({
        email: emailSchema,
        password: z.string().min(1).max(128).refine(
            (value) => Buffer.byteLength(value, "utf8") <= 72,
            "Password cannot exceed bcrypt's 72-byte input limit."
        )
    }).strict(), req.body);
    const [rows] = await db.execute(
        `SELECT u.id, u.email, u.full_name AS fullName, u.password_hash, u.account_status, u.account_hold,
                u.email_verified_at, u.password_change_required AS mustChangePassword, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
        [input.email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
        return res.status(401).json({ error: "Email or password is incorrect." });
    }
    if (user.account_status !== "active" || !user.email_verified_at) {
        return res.status(403).json({ error: "Verify your email or contact an administrator." });
    }
    const accessToken = signAccessToken(user);
    res.cookie("ebs_token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
        path: "/api"
    });
    res.json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, accountHold: Boolean(user.account_hold), mustChangePassword: Boolean(user.mustChangePassword) } });
});

router.post("/auth/change-temporary-password", ...passwordUpdateAllowed, async (req, res) => {
    const input = parse(z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: passwordSchema
    }).strict(), req.body);
    if (!req.user.mustChangePassword) {
        return res.status(409).json({ error: "This account does not need a temporary password change." });
    }
    const [rows] = await db.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!await bcrypt.compare(input.currentPassword, rows[0].password_hash)) {
        return res.status(400).json({ error: "The temporary password is incorrect." });
    }
    if (await bcrypt.compare(input.newPassword, rows[0].password_hash)) {
        return res.status(400).json({ error: "Choose a new password different from the temporary password." });
    }
    await db.execute(
        "UPDATE users SET password_hash = ?, password_change_required = FALSE WHERE id = ?",
        [await bcrypt.hash(input.newPassword, 12), req.user.id]
    );
    await audit(req, "auth.temporary_password_changed", "user", req.user.id);
    res.json({ message: "Password updated. You can now use your account." });
});

router.post("/auth/change-password", ...authRequired, async (req, res) => {
    const input = parse(z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: passwordSchema
    }).strict(), req.body);
    const [rows] = await db.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!await bcrypt.compare(input.currentPassword, rows[0].password_hash)) {
        return res.status(400).json({ error: "The current password is incorrect." });
    }
    if (await bcrypt.compare(input.newPassword, rows[0].password_hash)) {
        return res.status(400).json({ error: "Choose a new password different from your current password." });
    }
    await db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        [await bcrypt.hash(input.newPassword, 12), req.user.id]
    );
    await audit(req, "auth.password_changed", "user", req.user.id);
    res.json({ message: "Password changed successfully." });
});

router.post("/auth/logout", (req, res) => {
    res.clearCookie("ebs_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api"
    });
    res.status(204).end();
});

router.post("/auth/forgot-password", async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }).strict(), req.body);
    const [rows] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    let resetUrl;
    if (rows[0]) {
        const token = await createActionToken(rows[0].id, "reset_password");
        resetUrl = `${process.env.APP_BASE_URL || "http://localhost:5173"}/reset-password?token=${token}`;
        await deliverEmail({ to: email, subject: "Reset your EBS password", text: `Reset within 30 minutes: ${resetUrl}` });
    }
    res.json({
        message: "If the account exists, password reset instructions have been sent.",
        resetLink: process.env.NODE_ENV === "production" ? undefined : resetUrl
    });
});

router.post("/auth/reset-password", async (req, res) => {
    const input = parse(z.object({
        token: z.string().min(32).max(256),
        password: passwordSchema
    }).strict(), req.body);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [tokens] = await connection.execute(
            `SELECT id, user_id FROM auth_tokens
             WHERE token_hash = ? AND purpose = 'reset_password' AND used_at IS NULL
               AND expires_at > NOW() FOR UPDATE`,
            [tokenHash(input.token)]
        );
        if (!tokens.length) {
            await connection.rollback();
            return res.status(400).json({ error: "Password reset link is invalid or expired." });
        }
        await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
            await bcrypt.hash(input.password, 12), tokens[0].user_id
        ]);
        await connection.execute("UPDATE auth_tokens SET used_at = NOW() WHERE id = ?", [tokens[0].id]);
        await connection.commit();
        res.json({ message: "Password reset complete. Sign in with your new password." });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.get("/auth/me", ...passwordUpdateAllowed, async (req, res) => {
    const [rows] = await db.execute(
        `SELECT u.id, u.student_id AS studentId, u.full_name AS fullName, u.email, u.program, u.account_hold AS accountHold,
                u.password_change_required AS mustChangePassword,
                r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [req.user.id]
    );
    res.json({ user: { ...rows[0], accountHold: Boolean(rows[0].accountHold), mustChangePassword: Boolean(rows[0].mustChangePassword) } });
});

router.patch("/auth/profile", ...authRequired, async (req, res) => {
    const input = parse(z.object({
        fullName: z.string().trim().min(2).max(160),
        studentId: z.string().trim().min(3).max(40).nullable().optional(),
        program: z.string().trim().min(2).max(120).nullable().optional()
    }).strict(), req.body);
    if (req.user.role === "student" && (!input.studentId || !input.program)) {
        return res.status(400).json({ error: "Student profiles require a student ID and program." });
    }
    await db.execute(
        `UPDATE users SET full_name = ?,
             student_id = CASE WHEN ? IN ('student', 'faculty') THEN ? ELSE student_id END,
             program = CASE WHEN ? IN ('student', 'faculty') THEN ? ELSE program END
         WHERE id = ?`,
        [input.fullName, req.user.role, input.studentId ?? null, req.user.role, input.program ?? null, req.user.id]
    );
    const [rows] = await db.execute(
        `SELECT u.id, u.student_id AS studentId, u.full_name AS fullName, u.email,
                u.program, u.account_hold AS accountHold, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [req.user.id]
    );
    await audit(req, "profile.updated", "user", req.user.id);
    res.json({ message: "Profile updated.", user: { ...rows[0], accountHold: Boolean(rows[0].accountHold) } });
});

router.get("/users", ...adminOnly, async (req, res) => {
    const [rows] = await db.execute(
        `SELECT u.id, u.student_id AS studentId, u.full_name AS fullName, u.email, u.program, r.name AS role,
                u.account_status AS status, u.account_hold AS accountHold, u.email_verified_at AS emailVerifiedAt,
                u.password_change_required AS mustChangePassword
         FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC LIMIT 500`
    );
    res.json({ users: rows });
});

router.patch("/users/:id/name", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { fullName } = parse(z.object({
        fullName: z.string().trim().min(2).max(160)
    }).strict(), req.body);
    const [result] = await db.execute("UPDATE users SET full_name = ? WHERE id = ?", [fullName, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "User not found." });
    await audit(req, "user.name_updated", "user", id);
    res.json({ message: "Account name updated." });
});

router.post("/users", ...adminOnly, async (req, res) => {
    const input = parse(z.object({
        role: z.enum(["student", "faculty", "custodian", "administrator"]),
        fullName: z.string().trim().min(2).max(160).optional(),
        studentId: z.string().trim().min(3).max(40).optional(),
        email: emailSchema,
        program: z.string().trim().min(2).max(120).optional()
    }).strict(), req.body);
    if (borrowerRoles.includes(input.role) && (!input.fullName || (input.role === "student" && (!input.studentId || !input.program)))) {
        return res.status(400).json({ error: "Borrower accounts require a full name; student accounts also require a student ID and program." });
    }
    const [roles] = await db.execute("SELECT id FROM roles WHERE name = ?", [input.role]);
    const isCustodianInvite = input.role === "custodian";
    const temporaryPassword = isCustodianInvite ? crypto.randomBytes(18).toString("base64url") : null;
    const initialPassword = temporaryPassword || crypto.randomBytes(32).toString("hex");
    const [result] = await db.execute(
        `INSERT INTO users
            (role_id, student_id, full_name, email, program, password_hash, email_verified_at, password_change_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            roles[0].id, input.studentId || null, input.fullName || null, input.email, input.program || null,
            await bcrypt.hash(initialPassword, 12), isCustodianInvite ? new Date() : null, isCustodianInvite
        ]
    );
    if (isCustodianInvite) {
        await audit(req, "user.invited", "user", result.insertId, { role: input.role });
        return res.status(201).json({
            message: "Custodian account created. Share the temporary password privately; the custodian must change it at first sign-in.",
            email: input.email,
            temporaryPassword
        });
    }
    const resetToken = await createActionToken(result.insertId, "reset_password");
    const verifyToken = await createActionToken(result.insertId, "verify_email");
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}`;
    const emailSent = await deliverEmail({
        to: input.email,
        subject: "Your EBS account",
        text: `Set your password within 30 minutes: ${resetUrl}\nVerify your email: ${verifyUrl}`
    });
    await audit(req, "user.invited", "user", result.insertId, { role: input.role });
    res.status(201).json({
        message: emailSent
            ? "Account created. A password setup link was sent to the institutional email."
            : "Account created, but the invitation email could not be delivered. Check SMTP configuration and resend the invitation.",
        emailSent,
        setupLinks: emailSent && process.env.NODE_ENV === "production" ? undefined : { resetUrl, verifyUrl }
    });
});

router.post("/users/:id/resend-invitation", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [users] = await db.execute(
        `SELECT u.id, u.email, u.email_verified_at AS emailVerifiedAt, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [id]
    );
    const user = users[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "custodian") {
        const temporaryPassword = crypto.randomBytes(18).toString("base64url");
        await db.execute(
            `UPDATE auth_tokens SET used_at = NOW()
             WHERE user_id = ? AND used_at IS NULL`,
            [user.id]
        );
        await db.execute(
            `UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW()),
                 password_change_required = TRUE WHERE id = ?`,
            [await bcrypt.hash(temporaryPassword, 12), user.id]
        );
        await audit(req, "user.temporary_password_reset", "user", user.id);
        return res.json({
            message: "A new temporary password was generated. Share it privately; the custodian must change it at first sign-in.",
            email: user.email,
            temporaryPassword
        });
    }
    if (user.emailVerifiedAt) return res.status(409).json({ error: "This account is already verified." });

    await db.execute(
        `UPDATE auth_tokens SET used_at = NOW()
         WHERE user_id = ? AND purpose IN ('reset_password','verify_email') AND used_at IS NULL`,
        [user.id]
    );
    const resetToken = await createActionToken(user.id, "reset_password");
    const verifyToken = await createActionToken(user.id, "verify_email");
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}`;
    const emailSent = await deliverEmail({
        to: user.email,
        subject: "Your EBS account invitation",
        text: `Set your password within 30 minutes: ${resetUrl}\nVerify your email: ${verifyUrl}`
    });
    await audit(req, "user.invitation_resent", "user", user.id);
    res.json({
        message: emailSent
            ? "Invitation sent. The user can set their password and verify their email from the message."
            : "Invitation email could not be delivered. Share the setup links with the user privately.",
        emailSent,
        setupLinks: emailSent && process.env.NODE_ENV === "production" ? undefined : { resetUrl, verifyUrl }
    });
});

router.post("/users/:id/approve-borrower", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [users] = await db.execute(
        `SELECT u.id, u.email_verified_at AS emailVerifiedAt, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`,
        [id]
    );
    const user = users[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!borrowerRoles.includes(user.role)) {
        return res.status(400).json({ error: "Only student or faculty borrower accounts can be approved here." });
    }
    if (user.emailVerifiedAt) return res.status(409).json({ error: "This borrower is already approved." });

    await db.execute("UPDATE users SET email_verified_at = NOW() WHERE id = ?", [user.id]);
    await db.execute(
        `UPDATE auth_tokens SET used_at = NOW()
         WHERE user_id = ? AND purpose = 'verify_email' AND used_at IS NULL`,
        [user.id]
    );
    await audit(req, "borrower.approved_by_admin", "user", user.id, { role: user.role });
    res.json({ message: "Borrower approved. They can now sign in using their registered password." });
});

router.post("/users/:id/resend-verification", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [users] = await db.execute(
        "SELECT id, email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ?",
        [id]
    );
    const user = users[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.emailVerifiedAt) return res.status(409).json({ error: "This account is already verified." });

    await db.execute(
        `UPDATE auth_tokens SET used_at = NOW()
         WHERE user_id = ? AND purpose = 'verify_email' AND used_at IS NULL`,
        [user.id]
    );
    const token = await createActionToken(user.id, "verify_email");
    const verifyUrl = `${process.env.APP_BASE_URL || "http://localhost:5173"}/verify-email?token=${token}`;
    const emailSent = await deliverEmail({
        to: user.email,
        subject: "Verify your EBS account",
        text: `Verify your institutional email within 30 minutes: ${verifyUrl}`
    });
    await audit(req, "user.verification_resent", "user", user.id);

    res.json({
        message: emailSent
            ? "Verification link sent to the borrower's email."
            : "Verification email could not be delivered. Use the development link below or check SMTP settings.",
        emailSent,
        verificationLink: process.env.NODE_ENV === "production" ? undefined : verifyUrl
    });
});

router.patch("/users/:id/status", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { status } = parse(z.object({ status: z.enum(["active", "disabled"]) }).strict(), req.body);
    if (Number(id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot disable your own administrator account." });
    const [result] = await db.execute("UPDATE users SET account_status = ? WHERE id = ?", [status, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "User not found." });
    await audit(req, "user.status_changed", "user", id, { status });
    res.json({ message: `User account ${status}.` });
});

router.get("/categories", ...authRequired, async (req, res) => {
    const [rows] = await db.execute("SELECT id, name, description FROM categories ORDER BY name");
    res.json({ categories: rows });
});

router.post("/categories", ...adminOnly, async (req, res) => {
    const input = parse(z.object({
        name: z.string().trim().min(2).max(100),
        description: z.string().trim().max(500).optional()
    }).strict(), req.body);
    const [result] = await db.execute("INSERT INTO categories (name, description) VALUES (?, ?)", [input.name, input.description || null]);
    await audit(req, "category.created", "category", result.insertId);
    res.status(201).json({ id: result.insertId, ...input });
});

router.get("/notifications", ...authRequired, async (req, res) => {
    const [rows] = await db.execute(
        `SELECT id, type, subject, body, sent_at AS sentAt, read_at AS readAt, created_at AS createdAt
         FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
        [req.user.id]
    );
    res.json({ notifications: rows });
});

router.get("/notifications/unread-count", ...authRequired, async (req, res) => {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS count,
                SUM(type LIKE 'reservation_%') AS reservationCount
         FROM notifications WHERE user_id = ? AND read_at IS NULL`,
        [req.user.id]
    );
    let reservationCount = Number(rows[0].reservationCount || 0);
    if (staffRoles.includes(req.user.role)) {
        const [pending] = await db.execute(
            "SELECT COUNT(*) AS count FROM reservations WHERE status = 'pending'",
        );
        reservationCount = Number(pending[0].count);
    }
    res.json({ unreadCount: Number(rows[0].count), reservationCount });
});

router.post("/notifications/read", ...authRequired, async (req, res) => {
    await db.execute(
        "UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL",
        [req.user.id]
    );
    res.json({ message: "Notifications marked as read." });
});

router.post("/notifications/reservations/read", ...authRequired, async (req, res) => {
    await db.execute(
        `UPDATE notifications SET read_at = NOW()
         WHERE user_id = ? AND read_at IS NULL AND type LIKE 'reservation_%'`,
        [req.user.id]
    );
    res.json({ message: "Reservation notifications marked as read." });
});

router.get("/equipment", ...authRequired, async (req, res) => {
    const query = parse(z.object({
        q: z.string().trim().max(100).optional(),
        category: z.coerce.number().int().positive().optional(),
        status: z.enum(["Available", "Reserved", "Checked Out", "Under Maintenance", "Lost"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20)
    }), req.query);
    const conditions = ["e.archived_at IS NULL"];
    const params = [];
    if (query.q) {
        conditions.push("(e.name LIKE ? OR e.asset_code LIKE ? OR e.description LIKE ?)");
        const search = `%${query.q}%`;
        params.push(search, search, search);
    }
    if (query.category) {
        conditions.push("e.category_id = ?");
        params.push(query.category);
    }
    if (query.status) {
        conditions.push("e.status = ?");
        params.push(query.status);
    }
    const where = conditions.join(" AND ");
    const offset = (query.page - 1) * query.limit;
    const [rows] = await db.execute(
        `SELECT e.id, e.asset_code AS assetCode, e.name, e.description, e.serial_number AS serialNumber,
                e.qr_code AS qrCode, e.image_path AS imagePath,
                CASE WHEN e.image_data IS NULL THEN NULL
                  ELSE CONCAT('/api/equipment/', e.id, '/image') END AS imageUrl,
                e.quantity, e.location, e.status,
                c.id AS categoryId, c.name AS category
         FROM equipment e JOIN categories c ON c.id = e.category_id
         WHERE ${where} ORDER BY e.name LIMIT ? OFFSET ?`,
        [...params, query.limit, offset]
    );
    const [count] = await db.execute(`SELECT COUNT(*) AS total FROM equipment e WHERE ${where}`, params);
    res.json({ equipment: rows, pagination: { page: query.page, limit: query.limit, total: count[0].total } });
});

router.get("/equipment/:id", ...authRequired, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [rows] = await db.execute(
        `SELECT e.id, e.asset_code AS assetCode, e.name, e.description, e.serial_number AS serialNumber,
                CASE WHEN e.image_data IS NULL THEN NULL
                  ELSE CONCAT('/api/equipment/', e.id, '/image') END AS imageUrl,
                e.quantity, e.location, e.status,
                c.id AS categoryId, c.name AS category
         FROM equipment e JOIN categories c ON c.id = e.category_id
         WHERE e.id = ? AND e.archived_at IS NULL`,
        [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Equipment not found." });
    res.json({ equipment: rows[0] });
});

const equipmentInput = z.object({
    assetCode: z.string().trim().min(2).max(60),
    name: z.string().trim().min(2).max(160),
    description: z.string().max(4000).optional().nullable(),
    categoryId: z.coerce.number().int().positive(),
    serialNumber: z.string().trim().max(120).optional().nullable(),
    quantity: z.coerce.number().int().min(1).max(1000),
    location: z.string().trim().min(2).max(180),
    status: z.enum(["Available", "Reserved", "Checked Out", "Under Maintenance", "Lost"]).default("Available")
}).strict();

router.post("/equipment", ...staffOnly, async (req, res) => {
    const input = parse(equipmentInput, req.body);
    const qrCode = `EBS-${crypto.randomUUID()}`;
    const [result] = await db.execute(
        `INSERT INTO equipment
         (asset_code, name, description, category_id, serial_number, qr_code, quantity, location, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.assetCode, input.name, input.description || null, input.categoryId, input.serialNumber || null,
            qrCode, input.quantity, input.location, input.status, req.user.id]
    );
    const qrDataUrl = await QRCode.toDataURL(qrCode, { errorCorrectionLevel: "H", margin: 2 });
    await audit(req, "equipment.created", "equipment", result.insertId);
    res.status(201).json({ id: result.insertId, qrCode, qrDataUrl });
});

router.put("/equipment/:id", ...staffOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const input = parse(equipmentInput.partial().refine((value) => Object.keys(value).length > 0), req.body);
    const [currentRows] = await db.execute(
        "SELECT status FROM equipment WHERE id = ? AND archived_at IS NULL",
        [id]
    );
    if (!currentRows.length) return res.status(404).json({ error: "Equipment not found." });
    if (input.status === "Checked Out" && currentRows[0].status !== "Checked Out") {
        return res.status(409).json({ error: "Use the checkout workflow to mark equipment as checked out." });
    }
    if (input.status === "Available" && currentRows[0].status !== "Available") {
        const [[activeLoans]] = await db.execute(
            "SELECT COUNT(*) AS count FROM borrow_transactions WHERE equipment_id = ? AND status IN ('active','overdue')",
            [id]
        );
        const [[activeReservations]] = await db.execute(
            "SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ? AND status IN ('approved','pending','checked_out')",
            [id]
        );
        if (Number(activeLoans.count) > 0 || Number(activeReservations.count) > 0) {
            return res.status(409).json({ error: "Cancel active loans and reservations before marking the equipment available." });
        }
    }
    const fields = {
        assetCode: "asset_code", name: "name", description: "description", categoryId: "category_id",
        serialNumber: "serial_number", quantity: "quantity", location: "location", status: "status"
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(fields)) {
        if (Object.hasOwn(input, key)) {
            sets.push(`${column} = ?`);
            values.push(input[key] ?? null);
        }
    }
    const [result] = await db.execute(`UPDATE equipment SET ${sets.join(", ")} WHERE id = ? AND archived_at IS NULL`, [...values, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Equipment not found." });
    await audit(req, "equipment.updated", "equipment", id, input);
    res.json({ message: "Equipment updated." });
});

router.delete("/equipment/:id", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [[activeLoans]] = await db.execute(
        "SELECT COUNT(*) AS count FROM borrow_transactions WHERE equipment_id = ? AND status IN ('active','overdue')",
        [id]
    );
    const [[activeReservations]] = await db.execute(
        "SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ? AND status IN ('approved','pending','checked_out')",
        [id]
    );
    if (Number(activeLoans.count) > 0 || Number(activeReservations.count) > 0) {
        return res.status(409).json({ error: "Cancel active reservations and resolve active loans before archiving this item." });
    }
    const [result] = await db.execute(
        "UPDATE equipment SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL",
        [id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Equipment not found." });
    await audit(req, "equipment.archived", "equipment", id);
    res.status(204).end();
});

router.post("/equipment/:id/image", ...staffOnly, upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "An image file is required." });
    if (detectImageMime(req.file.buffer) !== req.file.mimetype) {
        return res.status(400).json({ error: "Image content does not match its declared file type." });
    }
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [result] = await db.execute(
        "UPDATE equipment SET image_mime = ?, image_data = ? WHERE id = ? AND archived_at IS NULL",
        [req.file.mimetype, req.file.buffer, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Equipment not found." });
    res.json({ message: "Equipment image updated." });
});

router.get("/equipment/:id/image", ...authRequired, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [rows] = await db.execute("SELECT image_mime, image_data FROM equipment WHERE id = ? AND archived_at IS NULL", [id]);
    if (!rows.length || !rows[0].image_data) return res.status(404).json({ error: "Equipment image not found." });
    res.type(rows[0].image_mime).set("Cache-Control", "private, max-age=300").send(rows[0].image_data);
});

router.get("/equipment/:id/qr", ...authRequired, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [rows] = await db.execute("SELECT qr_code FROM equipment WHERE id = ? AND archived_at IS NULL", [id]);
    if (!rows.length) return res.status(404).json({ error: "Equipment not found." });
    res.json({ qrCode: rows[0].qr_code, qrDataUrl: await QRCode.toDataURL(rows[0].qr_code) });
});

router.post("/reservations", ...authRequired, async (req, res) => {
    if (!borrowerRoles.includes(req.user.role)) return res.status(403).json({ error: "Only borrowers can reserve equipment." });
    const input = parse(z.object({
        equipmentId: z.coerce.number().int().positive(),
        pickupAt: z.string().datetime(),
        dueAt: z.string().datetime(),
        purpose: z.string().trim().min(5).max(500)
    }).strict(), req.body);
    const pickup = new Date(input.pickupAt);
    const due = new Date(input.dueAt);
    if (due <= pickup || pickup < new Date()) {
        return res.status(400).json({ error: "Choose a future pickup time and a later return time." });
    }
    if (!isCampusServiceTime(pickup) || !isCampusServiceTime(due)) {
        return res.status(400).json({ error: "Pickup and return times must be Monday through Saturday, 7:30 AM–5:30 PM campus time." });
    }
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [users] = await connection.execute(
            `SELECT account_hold, email_verified_at FROM users WHERE id = ? FOR UPDATE`,
            [req.user.id]
        );
        if (!users.length || users[0].account_hold || !users[0].email_verified_at) {
            await connection.rollback();
            return res.status(403).json({ error: "Your account has a hold or is not verified." });
        }
        const [overdue] = await connection.execute(
            "SELECT id FROM borrow_transactions WHERE borrower_id = ? AND status IN ('active','overdue') AND due_at < NOW() LIMIT 1",
            [req.user.id]
        );
        if (overdue.length) {
            await connection.execute("UPDATE users SET account_hold = TRUE WHERE id = ?", [req.user.id]);
            await connection.commit();
            return res.status(403).json({ error: "Resolve overdue equipment before requesting another reservation." });
        }
        const [active] = await connection.execute(
            `SELECT COUNT(*) AS count FROM reservations
             WHERE borrower_id = ? AND status IN ('approved','pending','checked_out')`,
            [req.user.id]
        );
        const maxActive = Number(process.env.MAX_ACTIVE_RESERVATIONS || 3);
        if (Number(active[0].count) >= maxActive) {
            await connection.rollback();
            return res.status(409).json({ error: `Active reservation limit (${maxActive}) reached.` });
        }
        const [items] = await connection.execute(
            "SELECT id, quantity, status FROM equipment WHERE id = ? AND archived_at IS NULL FOR UPDATE",
            [input.equipmentId]
        );
        if (!items.length || ["Under Maintenance", "Lost"].includes(items[0].status)) {
            await connection.rollback();
            return res.status(409).json({ error: "Equipment is unavailable." });
        }
        const [conflicts] = await connection.execute(
            `SELECT COUNT(*) AS count FROM reservations
             WHERE equipment_id = ? AND status IN ('approved','pending','checked_out')
               AND pickup_at < ? AND due_at > ?`,
            [input.equipmentId, due, pickup]
        );
        if (Number(conflicts[0].count) >= Number(items[0].quantity)) {
            await connection.rollback();
            return res.status(409).json({ error: "No units are available for that time slot." });
        }
        const code = crypto.randomUUID();
        const [created] = await connection.execute(
            `INSERT INTO reservations (reservation_code, equipment_id, borrower_id, pickup_at, due_at, purpose, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [code, input.equipmentId, req.user.id, pickup, due, input.purpose]
        );
        await connection.execute(
            `UPDATE equipment SET status = 'Reserved'
             WHERE id = ? AND status = 'Available'`,
            [input.equipmentId]
        );
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'reservation_submitted', 'Reservation request submitted',
                     ?, ?)`,
            [
                req.user.id,
                `Your request for reservation ${code} is awaiting custodian or administrator approval.`,
                String(created.insertId)
            ]
        );
        await connection.commit();
        const [borrower] = await db.execute("SELECT email FROM users WHERE id = ?", [req.user.id]);
        const emailSent = await deliverEmail({
            to: borrower[0].email,
            subject: "Equipment reservation request received",
            text: `Your reservation request ${code} is awaiting custodian or administrator approval. Requested pickup: ${pickup.toISOString()}. Requested return: ${due.toISOString()}.`
        });
        await audit(req, "reservation.created", "reservation", created.insertId);
        res.status(201).json({
            id: created.insertId,
            reservationCode: code,
            status: "pending",
            notificationWarning: emailSent ? undefined : "Request submitted, but email delivery failed. Check Notifications for updates."
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.get("/reservations", ...authRequired, async (req, res) => {
    const isStaff = staffRoles.includes(req.user.role);
    const borrowerId = isStaff && req.query.borrowerId
        ? parse(z.coerce.number().int().positive(), req.query.borrowerId)
        : req.user.id;
    const [rows] = await db.execute(
        `SELECT r.id, r.reservation_code AS reservationCode, r.equipment_id AS equipmentId,
                e.name AS equipmentName, e.asset_code AS assetCode, r.borrower_id AS borrowerId,
                u.email AS borrowerEmail, u.full_name AS borrowerName,
                r.pickup_at AS pickupAt, r.due_at AS dueAt,
                r.purpose, r.status, r.created_at AS createdAt
         FROM reservations r JOIN equipment e ON e.id = r.equipment_id
         JOIN users u ON u.id = r.borrower_id
         ${isStaff && !req.query.borrowerId ? "" : "WHERE r.borrower_id = ?"}
         ORDER BY r.created_at DESC LIMIT 500`,
        isStaff && !req.query.borrowerId ? [] : [borrowerId]
    );
    res.json({ reservations: rows });
});

router.post("/reservations/:id/approve", ...staffOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const connection = await db.getConnection();
    let borrower;
    let equipmentName;
    try {
        await connection.beginTransaction();
        const [reservations] = await connection.execute(
            `SELECT r.id, r.status, r.equipment_id AS equipmentId, r.borrower_id AS borrowerId,
                    r.pickup_at AS pickupAt, r.due_at AS dueAt, e.quantity, e.status AS equipmentStatus,
                    e.name AS equipmentName, u.email AS borrowerEmail
             FROM reservations r
             JOIN equipment e ON e.id = r.equipment_id
             JOIN users u ON u.id = r.borrower_id
             WHERE r.id = ? FOR UPDATE`,
            [id]
        );
        const reservation = reservations[0];
        if (!reservation) {
            await connection.rollback();
            return res.status(404).json({ error: "Reservation not found." });
        }
        if (reservation.status !== "pending") {
            await connection.rollback();
            return res.status(409).json({ error: "Only pending reservation requests can be approved." });
        }
        await connection.execute(
            "SELECT id FROM equipment WHERE id = ? FOR UPDATE",
            [reservation.equipmentId]
        );
        if (["Under Maintenance", "Lost"].includes(reservation.equipmentStatus)) {
            await connection.rollback();
            return res.status(409).json({ error: "Equipment is unavailable and this request cannot be approved." });
        }
        const [[capacity]] = await connection.execute(
            `SELECT COUNT(*) AS count FROM reservations
             WHERE equipment_id = ? AND id <> ?
               AND status IN ('approved','checked_out')
               AND pickup_at < ? AND due_at > ?`,
            [reservation.equipmentId, reservation.id, reservation.dueAt, reservation.pickupAt]
        );
        if (Number(capacity.count) >= Number(reservation.quantity)) {
            await connection.rollback();
            return res.status(409).json({ error: "There is no remaining equipment capacity for this time slot." });
        }
        await connection.execute("UPDATE reservations SET status = 'approved' WHERE id = ?", [id]);
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'reservation_approved', 'Reservation approved', ?, ?)`,
            [
                reservation.borrowerId,
                `Your request for ${reservation.equipmentName} was approved. You may collect it at the scheduled pickup time.`,
                String(id)
            ]
        );
        await connection.commit();
        borrower = reservation.borrowerEmail;
        equipmentName = reservation.equipmentName;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    const emailSent = await deliverEmail({
        to: borrower,
        subject: "Equipment reservation approved",
        text: `Your reservation for ${equipmentName} has been approved. Please collect it at the scheduled pickup time.`
    });
    await audit(req, "reservation.approved", "reservation", id);
    res.json({
        message: "Reservation approved.",
        notificationWarning: emailSent ? undefined : "Approval saved; the borrower can see the update in Notifications."
    });
});

router.post("/reservations/:id/reject", ...staffOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const input = parse(z.object({
        reason: z.string().trim().min(3).max(500)
    }).strict(), req.body);
    const connection = await db.getConnection();
    let borrower;
    let equipmentName;
    try {
        await connection.beginTransaction();
        const [reservations] = await connection.execute(
            `SELECT r.id, r.status, r.equipment_id AS equipmentId, r.borrower_id AS borrowerId,
                    e.name AS equipmentName, u.email AS borrowerEmail
             FROM reservations r
             JOIN equipment e ON e.id = r.equipment_id
             JOIN users u ON u.id = r.borrower_id
             WHERE r.id = ? FOR UPDATE`,
            [id]
        );
        const reservation = reservations[0];
        if (!reservation) {
            await connection.rollback();
            return res.status(404).json({ error: "Reservation not found." });
        }
        if (reservation.status !== "pending") {
            await connection.rollback();
            return res.status(409).json({ error: "Only pending reservation requests can be declined." });
        }
        await connection.execute("UPDATE reservations SET status = 'rejected' WHERE id = ?", [id]);
        await connection.execute(
            `UPDATE equipment SET status = 'Available'
             WHERE id = ? AND status = 'Reserved'
               AND NOT EXISTS (
                 SELECT 1 FROM reservations
                 WHERE equipment_id = ? AND status IN ('pending','approved','checked_out')
               )`,
            [reservation.equipmentId, reservation.equipmentId]
        );
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'reservation_rejected', 'Reservation declined', ?, ?)`,
            [
                reservation.borrowerId,
                `Your request for ${reservation.equipmentName} was declined. Reason: ${input.reason}`,
                String(id)
            ]
        );
        await connection.commit();
        borrower = reservation.borrowerEmail;
        equipmentName = reservation.equipmentName;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    const emailSent = await deliverEmail({
        to: borrower,
        subject: "Equipment reservation declined",
        text: `Your request for ${equipmentName} was declined. Reason: ${input.reason}`
    });
    await audit(req, "reservation.rejected", "reservation", id, { reason: input.reason });
    res.json({
        message: "Reservation declined.",
        notificationWarning: emailSent ? undefined : "Decline saved; the borrower can see the update in Notifications."
    });
});

router.post("/reservations/:id/cancel", ...authRequired, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [result] = await db.execute(
        `UPDATE reservations SET status = 'cancelled'
         WHERE id = ? AND status IN ('pending','approved') AND (? IN ('custodian','administrator') OR borrower_id = ?)`,
        [id, req.user.role, req.user.id]
    );
    if (!result.affectedRows) return res.status(409).json({ error: "Reservation cannot be cancelled or does not exist." });
    const [[reservation]] = await db.execute("SELECT equipment_id FROM reservations WHERE id = ?", [id]);
    await db.execute(
        `UPDATE equipment SET status = 'Available'
         WHERE id = ? AND status = 'Reserved'
           AND NOT EXISTS (
             SELECT 1 FROM reservations WHERE equipment_id = ? AND status IN ('approved','pending','checked_out')
           )`,
        [reservation.equipment_id, reservation.equipment_id]
    );
    await audit(req, "reservation.cancelled", "reservation", id);
    res.json({ message: "Reservation cancelled." });
});

router.post("/checkout", ...staffOnly, async (req, res) => {
    const input = parse(z.object({
        qrCode: z.string().trim().min(3).max(200),
        reservationCode: z.string().trim().uuid()
    }).strict(), req.body);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT r.id, r.reservation_code, r.equipment_id, r.borrower_id, r.pickup_at, r.due_at,
                    r.status AS reservation_status, e.qr_code, e.status AS equipment_status,
                    e.quantity, e.name AS equipment_name, u.email, u.account_hold
             FROM reservations r JOIN equipment e ON e.id = r.equipment_id
             JOIN users u ON u.id = r.borrower_id
             WHERE r.reservation_code = ? FOR UPDATE`,
            [input.reservationCode]
        );
        const row = rows[0];
        if (!row || row.qr_code !== input.qrCode || ["Under Maintenance", "Lost"].includes(row.equipment_status) ||
            row.reservation_status !== "approved") {
            await connection.rollback();
            return res.status(409).json({ error: "QR code or reservation is invalid, or equipment is unavailable." });
        }
        if (row.account_hold) {
            await connection.rollback();
            return res.status(403).json({ error: "Borrower account is on hold." });
        }
        if (new Date(row.pickup_at) > new Date() || new Date(row.due_at) <= new Date()) {
            await connection.rollback();
            return res.status(409).json({ error: "This reservation is outside its pickup and return window." });
        }
        const [[activeLoans]] = await connection.execute(
            "SELECT COUNT(*) AS count FROM borrow_transactions WHERE equipment_id = ? AND status IN ('active','overdue')",
            [row.equipment_id]
        );
        if (Number(activeLoans.count) >= Number(row.quantity)) {
            await connection.rollback();
            return res.status(409).json({ error: "All equipment units are currently checked out." });
        }
        const [overdue] = await connection.execute(
            "SELECT id FROM borrow_transactions WHERE borrower_id = ? AND status IN ('active','overdue') AND due_at < NOW() LIMIT 1",
            [row.borrower_id]
        );
        if (overdue.length) {
            await connection.rollback();
            return res.status(403).json({ error: "Borrower has overdue equipment and cannot check out another item." });
        }
        const [created] = await connection.execute(
            `INSERT INTO borrow_transactions (reservation_id, equipment_id, borrower_id, processed_by, due_at)
             VALUES (?, ?, ?, ?, ?)`,
            [row.id, row.equipment_id, row.borrower_id, req.user.id, row.due_at]
        );
        await connection.execute("UPDATE reservations SET status = 'checked_out' WHERE id = ?", [row.id]);
        await connection.execute("UPDATE equipment SET status = 'Checked Out' WHERE id = ?", [row.equipment_id]);
        const checkoutNotice = `Staff confirmed that you collected ${row.equipment_name}. It is due back ${new Date(row.due_at).toLocaleString()}.`;
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'equipment_collected', 'Equipment pickup confirmed', ?, ?)`,
            [row.borrower_id, checkoutNotice, String(created.insertId)]
        );
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'equipment_collected_staff', 'Equipment pickup recorded', ?, ?)`,
            [req.user.id, `${row.email} collected ${row.equipment_name}. Due ${new Date(row.due_at).toLocaleString()}.`, String(created.insertId)]
        );
        await connection.commit();
        const emailSent = await deliverEmail({
            to: row.email, subject: "Equipment checked out",
            text: `Checkout confirmed. Transaction ${created.insertId}; due ${new Date(row.due_at).toISOString()}.`
        });
        await audit(req, "equipment.checked_out", "borrow_transaction", created.insertId);
        res.status(201).json({
            transactionId: created.insertId,
            borrowerEmail: row.email,
            dueAt: row.due_at,
            notificationWarning: emailSent ? undefined : "Checkout was saved and appears in Notifications, but confirmation email delivery failed."
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.get("/receipts/:id/pdf", ...authRequired, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [rows] = await db.execute(
        `SELECT bt.id, bt.borrower_id, bt.checked_out_at, bt.due_at, r.reservation_code,
                borrower.email AS borrower_email, processor.email AS processed_by,
                e.asset_code, e.name AS equipment_name, e.location
         FROM borrow_transactions bt JOIN reservations r ON r.id = bt.reservation_id
         JOIN users borrower ON borrower.id = bt.borrower_id
         JOIN users processor ON processor.id = bt.processed_by
         JOIN equipment e ON e.id = bt.equipment_id WHERE bt.id = ?`,
        [id]
    );
    const receipt = rows[0];
    if (!receipt || (!staffRoles.includes(req.user.role) && Number(receipt.borrower_id) !== Number(req.user.id))) {
        return res.status(404).json({ error: "Checkout receipt not found." });
    }
    const PDFDocument = require("pdfkit");
    res.type("application/pdf").attachment(`ebs-checkout-${id}.pdf`);
    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);
    doc.fontSize(20).text("Equipment Borrowing System", { align: "center" });
    doc.moveDown().fontSize(15).text("Digital checkout receipt");
    doc.moveDown().fontSize(11);
    [
        ["Transaction", receipt.id],
        ["Reservation", receipt.reservation_code],
        ["Borrower", receipt.borrower_email],
        ["Equipment", `${receipt.equipment_name} (${receipt.asset_code})`],
        ["Pickup location", receipt.location],
        ["Checked out", new Date(receipt.checked_out_at).toLocaleString()],
        ["Due", new Date(receipt.due_at).toLocaleString()],
        ["Processed by", receipt.processed_by]
    ].forEach(([label, value]) => doc.text(`${label}: ${value}`));
    doc.moveDown().fontSize(9).fillColor("gray").text("Please return the equipment by the listed due time.");
    doc.end();
});

router.post("/return", ...staffOnly, async (req, res) => {
    const input = parse(z.object({
        qrCode: z.string().trim().min(3).max(200),
        condition: z.enum(["Good", "Damaged", "Missing Parts"]),
        notes: z.string().trim().max(4000).optional(),
        photo: z.string().max(7_000_000).optional()
    }).strict(), req.body);
    const photoData = input.photo ? Buffer.from(input.photo.replace(/^data:image\/(?:jpeg|png|webp);base64,/, ""), "base64") : null;
    if (input.photo && (!photoData || photoData.length > 5 * 1024 * 1024)) {
        return res.status(400).json({ error: "Photo must be a valid image no larger than 5 MB." });
    }
    if (input.photo) {
        const mime = input.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,/)?.[1];
        if (!mime || detectImageMime(photoData) !== mime) {
            return res.status(400).json({ error: "Photo content must be a valid JPEG, PNG, or WebP image." });
        }
    }
    if (input.condition !== "Good" && (!input.notes || !input.notes.trim() || !photoData)) {
        return res.status(400).json({ error: "Damage or missing parts requires incident notes and a photo." });
    }
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT bt.id, bt.equipment_id, bt.borrower_id, e.id AS item_id, u.email
             FROM borrow_transactions bt JOIN equipment e ON e.id = bt.equipment_id
             JOIN users u ON u.id = bt.borrower_id
             WHERE e.qr_code = ? AND bt.status IN ('active','overdue') FOR UPDATE`,
            [input.qrCode]
        );
        if (rows.length !== 1) {
            await connection.rollback();
            return res.status(409).json({ error: "No single active loan matches this QR code." });
        }
        const loan = rows[0];
        const [returned] = await connection.execute(
            `INSERT INTO returns (transaction_id, processed_by, condition_status, notes, photo_data)
             VALUES (?, ?, ?, ?, ?)`,
            [loan.id, req.user.id, input.condition, input.notes || null, photoData]
        );
        await connection.execute(
            "UPDATE borrow_transactions SET status = 'returned', returned_at = NOW() WHERE id = ?",
            [loan.id]
        );
        await connection.execute(
            "UPDATE reservations SET status = 'completed' WHERE id = (SELECT reservation_id FROM borrow_transactions WHERE id = ?)",
            [loan.id]
        );
        const conditionSummary = input.condition === "Good"
            ? "The item was inspected and returned in good condition."
            : `The item was inspected and recorded as ${input.condition.toLowerCase()}. Contact the equipment custodian about the incident.`;
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'equipment_returned', 'Equipment return recorded', ?, ?)`,
            [loan.borrower_id, `${conditionSummary} Return time: ${new Date().toLocaleString()}.`, String(loan.id)]
        );
        await connection.execute(
            `INSERT INTO notifications (user_id, type, subject, body, reference_id)
             VALUES (?, 'equipment_returned_staff', 'Equipment return recorded', ?, ?)`,
            [req.user.id, `Return from ${loan.email} was recorded. Condition: ${input.condition}.`, String(loan.id)]
        );
        if (input.condition === "Good") {
            const [[activeLoans]] = await connection.execute(
                "SELECT COUNT(*) AS count FROM borrow_transactions WHERE equipment_id = ? AND status IN ('active','overdue')",
                [loan.item_id]
            );
            const [[activeReservations]] = await connection.execute(
                "SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ? AND status IN ('approved','pending','checked_out')",
                [loan.item_id]
            );
            const status = Number(activeLoans.count) > 0 ? "Checked Out" : Number(activeReservations.count) > 0 ? "Reserved" : "Available";
            await connection.execute("UPDATE equipment SET status = ? WHERE id = ?", [status, loan.item_id]);
            const [[openIncidents]] = await connection.execute(
                "SELECT COUNT(*) AS count FROM damage_reports WHERE borrower_id = ? AND status <> 'resolved'",
                [loan.borrower_id]
            );
            const [[overdueLoans]] = await connection.execute(
                "SELECT COUNT(*) AS count FROM borrow_transactions WHERE borrower_id = ? AND status IN ('active','overdue') AND due_at < NOW()",
                [loan.borrower_id]
            );
            if (Number(openIncidents.count) === 0 && Number(overdueLoans.count) === 0) {
                await connection.execute("UPDATE users SET account_hold = FALSE WHERE id = ?", [loan.borrower_id]);
            }
        } else {
            await connection.execute("UPDATE equipment SET status = 'Under Maintenance' WHERE id = ?", [loan.item_id]);
            await connection.execute("UPDATE users SET account_hold = TRUE WHERE id = ?", [loan.borrower_id]);
            const [damage] = await connection.execute(
                `INSERT INTO damage_reports (return_id, equipment_id, borrower_id, notes, photo_path)
                 VALUES (?, ?, ?, ?, ?)`,
                [returned.insertId, loan.item_id, loan.borrower_id, input.notes, ""]
            );
            await connection.execute("UPDATE damage_reports SET photo_path = ? WHERE id = ?", [
                `/api/damage-reports/${damage.insertId}/photo`, damage.insertId
            ]);
        }
        await connection.commit();
        const emailSent = await deliverEmail({
            to: loan.email,
            subject: input.condition === "Good" ? "Equipment return confirmed" : "Equipment incident recorded",
            text: input.condition === "Good"
                ? "Your equipment return has been recorded."
                : `A ${input.condition.toLowerCase()} incident was recorded. Contact the equipment custodian to resolve the account hold.`
        });
        await audit(req, "equipment.returned", "borrow_transaction", loan.id, { condition: input.condition });
        res.status(201).json({
            returnId: returned.insertId,
            condition: input.condition,
            accountHold: input.condition !== "Good",
            notificationWarning: emailSent ? undefined : "Return was saved and appears in Notifications, but confirmation email delivery failed."
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.get("/damage-reports/:id/photo", ...staffOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [rows] = await db.execute(
        "SELECT r.photo_data FROM returns r JOIN damage_reports d ON d.return_id = r.id WHERE d.id = ?",
        [id]
    );
    if (!rows.length || !rows[0].photo_data) return res.status(404).json({ error: "Incident photo not found." });
    res.type("application/octet-stream").set("Content-Disposition", "attachment; filename=\"incident-photo\"").send(rows[0].photo_data);
});

router.get("/damage-reports", ...staffOnly, async (req, res) => {
    const status = parse(z.enum(["open", "reviewing", "resolved"]).optional(), req.query.status);
    const [rows] = await db.execute(
        `SELECT d.id, d.equipment_id AS equipmentId, e.name AS equipmentName,
                e.asset_code AS assetCode, d.borrower_id AS borrowerId, u.email AS borrowerEmail,
                d.notes, d.status, d.created_at AS createdAt
         FROM damage_reports d JOIN equipment e ON e.id = d.equipment_id
         JOIN users u ON u.id = d.borrower_id
         ${status ? "WHERE d.status = ?" : ""}
         ORDER BY d.created_at DESC LIMIT 500`,
        status ? [status] : []
    );
    res.json({ damageReports: rows });
});

router.put("/damage-reports/:id/resolve", ...adminOnly, async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [reports] = await connection.execute(
            `SELECT d.id, d.borrower_id, d.equipment_id FROM damage_reports d
             WHERE d.id = ? AND d.status <> 'resolved' FOR UPDATE`,
            [id]
        );
        if (!reports.length) {
            await connection.rollback();
            return res.status(404).json({ error: "Open damage report not found." });
        }
        const report = reports[0];
        await connection.execute("UPDATE damage_reports SET status = 'resolved' WHERE id = ?", [id]);
        await connection.execute("UPDATE equipment SET status = 'Available' WHERE id = ?", [report.equipment_id]);
        const [holds] = await connection.execute(
            `SELECT COUNT(*) AS count FROM damage_reports WHERE borrower_id = ? AND status <> 'resolved' AND id <> ?`,
            [report.borrower_id, id]
        );
        const [overdue] = await connection.execute(
            "SELECT COUNT(*) AS count FROM borrow_transactions WHERE borrower_id = ? AND status IN ('active','overdue') AND due_at < NOW()",
            [report.borrower_id]
        );
        if (Number(holds[0].count) === 0 && Number(overdue[0].count) === 0) {
            await connection.execute("UPDATE users SET account_hold = FALSE WHERE id = ?", [report.borrower_id]);
        }
        await connection.commit();
        await audit(req, "damage_report.resolved", "damage_report", id);
        res.json({ message: "Damage report resolved." });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

router.get("/reports/dashboard", ...staffOnly, async (req, res) => {
    const [[equipment]] = await db.execute("SELECT COUNT(*) AS total FROM equipment WHERE archived_at IS NULL");
    const [[borrowers]] = await db.execute(
        `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name IN ('student','faculty') AND u.account_status = 'active'`
    );
    const [[reservations]] = await db.execute("SELECT COUNT(*) AS total FROM reservations WHERE status IN ('approved','pending')");
    const [[checkedOut]] = await db.execute("SELECT COUNT(*) AS total FROM borrow_transactions WHERE status IN ('active','overdue')");
    const [[overdue]] = await db.execute("SELECT COUNT(*) AS total FROM borrow_transactions WHERE status = 'overdue' OR (status = 'active' AND due_at < NOW())");
    const [[damaged]] = await db.execute("SELECT COUNT(*) AS total FROM damage_reports WHERE status <> 'resolved'");
    const [monthly] = await db.execute(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
         FROM borrow_transactions WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
         GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month`
    );
    const [popular] = await db.execute(
        `SELECT e.name, COUNT(*) AS count FROM borrow_transactions bt
         JOIN equipment e ON e.id = bt.equipment_id GROUP BY e.id, e.name ORDER BY count DESC LIMIT 10`
    );
    const [categoryUsage] = await db.execute(
         `SELECT c.name, COUNT(*) AS count FROM borrow_transactions bt
          JOIN equipment e ON e.id = bt.equipment_id JOIN categories c ON c.id = e.category_id
          GROUP BY c.id, c.name ORDER BY count DESC LIMIT 10`
    );
    const [damageTrend] = await db.execute(
         `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
          FROM damage_reports WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
          GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month`
    );
    res.json({
        totals: { equipment: equipment.total, borrowers: borrowers.total, activeReservations: reservations.total,
            checkedOut: checkedOut.total, overdue: overdue.total, damaged: damaged.total },
        monthlyBorrowing: monthly,
        mostBorrowedEquipment: popular,
        equipmentUsage: categoryUsage,
        damageStatistics: damageTrend
    });
});

async function reportRows(type) {
    const reports = {
        inventory: `SELECT e.asset_code, e.name, c.name AS category, e.quantity, e.location, e.status
                    FROM equipment e JOIN categories c ON c.id = e.category_id WHERE e.archived_at IS NULL ORDER BY e.name`,
        overdue: `SELECT bt.id AS transaction_id, u.email AS borrower, e.name AS equipment, bt.due_at, bt.status
                  FROM borrow_transactions bt JOIN users u ON u.id = bt.borrower_id
                  JOIN equipment e ON e.id = bt.equipment_id
                  WHERE bt.status = 'overdue' OR (bt.status = 'active' AND bt.due_at < NOW()) ORDER BY bt.due_at`,
        damage: `SELECT d.id, e.name AS equipment, u.email AS borrower, d.notes, d.status, d.created_at
                 FROM damage_reports d JOIN equipment e ON e.id = d.equipment_id
                 JOIN users u ON u.id = d.borrower_id ORDER BY d.created_at DESC`,
        usage: `SELECT e.name AS equipment, COUNT(*) AS checkout_count,
                DATE_FORMAT(bt.checked_out_at, '%Y-%m') AS month
                FROM borrow_transactions bt JOIN equipment e ON e.id = bt.equipment_id
                WHERE bt.checked_out_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
                GROUP BY e.id, e.name, DATE_FORMAT(bt.checked_out_at, '%Y-%m')
                ORDER BY month DESC, checkout_count DESC`
    };
    if (!reports[type]) return null;
    const [rows] = await db.query(reports[type]);
    return rows;
}

router.get("/reports/:type/csv", ...staffOnly, async (req, res) => {
    const type = parse(z.enum(["usage", "damage", "overdue", "inventory"]), req.params.type);
    const rows = await reportRows(type);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const escape = (value) => {
        const text = String(value ?? "");
        const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
        return `"${safe.replaceAll('"', '""')}"`;
    };
    const csv = [columns.map(escape).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n");
    res.type("text/csv").attachment(`${type}-report.csv`).send(csv);
});

router.get("/reports/:type/pdf", ...staffOnly, async (req, res) => {
    const type = parse(z.enum(["usage", "damage", "overdue", "inventory"]), req.params.type);
    const rows = await reportRows(type);
    const PDFDocument = require("pdfkit");
    res.type("application/pdf").attachment(`${type}-report.pdf`);
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    doc.pipe(res);
    doc.fontSize(18).text(`EBS ${type.toUpperCase()} REPORT`, { align: "center" });
    doc.moveDown().fontSize(9);
    rows.forEach((row, index) => {
        const line = Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? "").slice(0, 120)}`).join("  |  ");
        doc.text(line, { width: 760 });
        if (index < rows.length - 1) doc.moveDown(0.4);
    });
    if (!rows.length) doc.text("No records.");
    doc.end();
});

module.exports = router;
