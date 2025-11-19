// src/api.routes.ts
import { Router, Request, Response } from "express";
import iaRouter from "./routes/ia.routes";
import contactRouter from "./routes/contact.routes";

const router = Router();

/**
 * Health general de la API
 * GET /api/health
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "RIDS backend TS funcionando ✅" });
});

/**
 * Info básica de la API
 * GET /api/info
 */
router.get("/info", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    name: "RIDS Backend API",
    version: "1.0.0",
  });
});

/**
 * Rutas de IA
 */
router.use("/ia", iaRouter);

/**
 * Rutas de contacto (formulario web)
 */
router.use("/contact", contactRouter);

export default router;
