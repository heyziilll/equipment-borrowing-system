const db = require("../../config/db");

async function audit(req, action, entityType, entityId, details = {}) {
    await db.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            req.user?.id || null,
            action,
            entityType,
            entityId == null ? null : String(entityId),
            JSON.stringify(details),
            req.ip || null
        ]
    );
}

module.exports = { audit };
