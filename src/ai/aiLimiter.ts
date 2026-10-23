// src/ai/aiLimiter.ts
import rateLimit from "express-rate-limit";

export const aiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        ok: false,
        error:
            "Has realizado demasiadas consultas. Intenta nuevamente en unos minutos.",
    },
});