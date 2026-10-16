const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(__dirname, "../../.env");

function ensureDevelopmentJwtSecret() {
    if (!fs.existsSync(envPath)) {
        throw new Error("No .env file found. Copy .env.example to .env first.");
    }

    const source = fs.readFileSync(envPath, "utf8");
    const matches = [...source.matchAll(/^JWT_SECRET\s*=.*$/gm)];
    if (matches.length > 1) {
        throw new Error("Multiple JWT_SECRET entries found in .env. Keep only one entry and retry.");
    }

    const currentSecret = matches[0]?.[0].slice(matches[0][0].indexOf("=") + 1).trim();
    const isPlaceholder = !currentSecret || /^["']?replace[-_ ]with/i.test(currentSecret);
    if (!isPlaceholder && currentSecret.length >= 32) {
        console.log("JWT_SECRET is already configured; no changes made.");
        return;
    }

    const fileNodeEnv = source.match(/^NODE_ENV\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
    if ((process.env.NODE_ENV || fileNodeEnv) === "production") {
        throw new Error("Refusing to generate a development JWT_SECRET when NODE_ENV=production.");
    }

    const newSecret = crypto.randomBytes(48).toString("base64url");
    const updated = matches.length
        ? source.replace(matches[0][0], `JWT_SECRET=${newSecret}`)
        : `${source}${source.endsWith("\n") || source.length === 0 ? "" : "\n"}JWT_SECRET=${newSecret}\n`;
    fs.writeFileSync(envPath, updated, { mode: 0o600 });
    console.log("Generated a strong development JWT_SECRET in .env. The value was not displayed.");
}

try {
    ensureDevelopmentJwtSecret();
} catch (error) {
    console.error(`JWT setup failed: ${error.message}`);
    process.exitCode = 1;
}
