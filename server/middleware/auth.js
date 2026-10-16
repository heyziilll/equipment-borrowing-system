const jwt = require("jsonwebtoken");
const db = require("../../config/db");

function authenticate(req, res, next) {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    const jwtToken = scheme === "Bearer" ? token : req.cookies?.ebs_token;
    if (!jwtToken) {
        return res.status(401).json({ error: "Authentication required." });
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        return next(new Error("JWT_SECRET must contain at least 32 characters."));
    }
    try {
        req.auth = jwt.verify(jwtToken, process.env.JWT_SECRET);
        return next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired access token." });
    }
}

function authorize(roles, allowPasswordChange = false) {
    return async (req, res, next) => {
        try {
            if (!req.auth?.sub) return res.status(401).json({ error: "Authentication required." });
            const [rows] = await db.execute(
                `SELECT u.id, u.role_id, r.name AS role, u.email, u.account_status,
                        u.account_hold, u.email_verified_at,
                        u.password_change_required AS mustChangePassword
                 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
                [req.auth.sub]
            );
            const user = rows[0];
            if (!user || user.account_status !== "active" || !user.email_verified_at) {
                return res.status(403).json({ error: "This account is not active or verified." });
            }
            if (roles.length && !roles.includes(user.role)) {
                return res.status(403).json({ error: "You do not have permission to perform this action." });
            }
            if (user.mustChangePassword && !allowPasswordChange) {
                return res.status(403).json({
                    error: "Change your temporary password before continuing.",
                    code: "PASSWORD_CHANGE_REQUIRED"
                });
            }
            req.user = { ...user, mustChangePassword: Boolean(user.mustChangePassword) };
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function allow(...roles) {
    return authorize(roles);
}

function allowPasswordUpdate() {
    return authorize([], true);
}

module.exports = { authenticate, allow, allowPasswordUpdate };
