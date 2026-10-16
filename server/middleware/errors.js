function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error.name === "MulterError") {
        return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.message });
    }
    if (error.message?.startsWith("Only JPEG")) {
        return res.status(400).json({ error: error.message });
    }
    if (error.name === "ZodError") {
        return res.status(400).json({
            error: "Validation failed.",
            details: error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message
            }))
        });
    }
    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "A record with that value already exists." });
    }
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(400).json({ error: "A referenced record does not exist." });
    }
    console.error("Request failed:", error.message);
    return res.status(error.status || 500).json({
        error: error.status ? error.message : "An unexpected server error occurred."
    });
}

module.exports = { errorHandler };
