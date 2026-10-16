require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const api = require("./server/routes/api");
const { errorHandler } = require("./server/middleware/errors");

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());

app.disable("x-powered-by");
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: { directives: { "style-src-attr": ["'unsafe-inline'"] } }
}));
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin is not allowed by CORS."));
    },
    credentials: true
}));
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());
app.use("/api/auth", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false
}));

app.get("/health", async (req, res, next) => {
    try {
        const db = require("./config/db");
        const [admins] = await db.execute(
            `SELECT u.id
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE r.name = 'administrator'
             LIMIT 1`
        );
        const checks = {
            database: "connected",
            authenticationConfig: process.env.JWT_SECRET?.length >= 32 ? "ready" : "invalid",
            adminAccount: admins.length ? "present" : "missing"
        };
        const ready = checks.authenticationConfig === "ready" && checks.adminAccount === "present";
        res.status(ready ? 200 : 503).json({
            application: "Equipment Borrowing System",
            status: ready ? "ready" : "needs-setup",
            checks
        });
    } catch (error) {
        next(error);
    }
});

app.use("/api", api);

if (process.env.NODE_ENV === "production") {
    const clientDist = path.join(__dirname, "client", "dist");
    app.use(express.static(clientDist));
    app.get("/{*splat}", (req, res, next) => {
        if (req.path.startsWith("/api/")) return next();
        return res.sendFile(path.join(clientDist, "index.html"));
    });
}

app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use(errorHandler);

if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    const invalidSettings = [];
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        invalidSettings.push("JWT_SECRET (must contain at least 32 characters)");
    }
    if (process.env.NODE_ENV === "production") {
        const requiredProductionSettings = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"];
        invalidSettings.push(...requiredProductionSettings.filter((key) => !process.env[key]));
    }
    if (invalidSettings.length) {
        console.error(`Missing or invalid configuration: ${invalidSettings.join(", ")}`);
        process.exitCode = 1;
    } else {
        const db = require("./config/db");
        db.query("SELECT 1")
            .then(() => app.listen(port, () => {
                require("./server/services/scheduler").startScheduler();
                console.log(`EBS API listening on port ${port}`);
            }))
            .catch((error) => {
                console.error("Database connection failed:", error.message);
                process.exitCode = 1;
            });
    }
}

module.exports = app;
