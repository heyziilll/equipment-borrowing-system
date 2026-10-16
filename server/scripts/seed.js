require("dotenv").config();

const bcrypt = require("bcrypt");
const db = require("../../config/db");

async function seed() {
    const email = process.env.EBS_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.EBS_ADMIN_PASSWORD;
    if (!email || !password || password.length < 16) {
        throw new Error("Set EBS_ADMIN_EMAIL and an EBS_ADMIN_PASSWORD of at least 16 characters before seeding.");
    }
    const [roles] = await db.execute("SELECT id FROM roles WHERE name = 'administrator'");
    if (!roles.length) throw new Error("Run database/schema.sql first to create the role records.");
    const [existing] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) {
        console.log("Administrator account already exists; no changes made.");
    } else {
        const hash = await bcrypt.hash(password, 12);
        await db.execute(
            `INSERT INTO users (role_id, email, password_hash, email_verified_at)
             VALUES (?, ?, ?, NOW())`,
            [roles[0].id, email, hash]
        );
        console.log("Initial administrator account created.");
    }
    await db.execute(
        `INSERT IGNORE INTO categories (name, description) VALUES
         ('Audio Visual', 'Projectors, screens, and presentation equipment'),
         ('Computing', 'Laptops, tablets, and computing accessories'),
         ('Laboratory', 'Academic laboratory tools and kits'),
         ('Networking', 'Network testing and connectivity equipment')`
    );
    const starterEquipment = [
        ["DEMO-AV-001", "Portable Projector", "HDMI classroom projector for presentations.", "Audio Visual", "DEMO-SN-AV-001", 2, "Equipment Custodian Office"],
        ["DEMO-AV-002", "Portable Projection Screen", "Foldable projection screen for classrooms and events.", "Audio Visual", "DEMO-SN-AV-002", 2, "Equipment Custodian Office"],
        ["DEMO-CMP-001", "Laptop", "Academic-use laptop for classroom demonstrations.", "Computing", "DEMO-SN-CMP-001", 5, "Computer Laboratory"],
        ["DEMO-CMP-002", "Wireless Presentation Clicker", "USB wireless presenter with laser pointer.", "Computing", "DEMO-SN-CMP-002", 4, "Equipment Custodian Office"],
        ["DEMO-LAB-001", "Digital Multimeter", "Handheld digital multimeter for laboratory instruction.", "Laboratory", "DEMO-SN-LAB-001", 6, "Electronics Laboratory"],
        ["DEMO-LAB-002", "Soldering Station", "Temperature-controlled station for supervised lab activities.", "Laboratory", "DEMO-SN-LAB-002", 3, "Electronics Laboratory"],
        ["DEMO-NET-001", "Network Cable Tester", "Cable tester kit for networking laboratory exercises.", "Networking", "DEMO-SN-NET-001", 4, "Networking Laboratory"],
        ["DEMO-NET-002", "Crimping Tool Kit", "RJ45 crimping tool and basic network termination kit.", "Networking", "DEMO-SN-NET-002", 4, "Networking Laboratory"]
    ];
    for (const [assetCode, name, description, category, serialNumber, quantity, location] of starterEquipment) {
        await db.execute(
            `INSERT IGNORE INTO equipment
                (asset_code, name, description, category_id, serial_number, qr_code, quantity, location, status)
             SELECT ?, ?, ?, id, ?, ?, ?, ?, 'Available'
             FROM categories WHERE name = ?`,
            [assetCode, name, description, serialNumber, `EBS:${assetCode}`, quantity, location, category]
        );
    }
    console.log("Starter demo equipment is present (DEMO-* asset codes).");
}

seed()
    .catch((error) => {
        console.error("Database seed failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => db.end());
