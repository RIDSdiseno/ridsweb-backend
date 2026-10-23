// src/ai/contactLimiter.ts
import rateLimit from "express-rate-limit";

export const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    ok: false,
    error:
      "Has realizado demasiadas solicitudes. Intenta nuevamente en unos minutos.",
  },
});