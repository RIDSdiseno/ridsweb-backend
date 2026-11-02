// src/api.routes.ts

import {
  Router,
  Request,
  Response,
} from "express";

import iaRouter from "./routes/ia.routes";
import contactRouter from "./routes/contact.routes";
import analizadorRouter from "./analizador/analizador.routes";

const router = Router();

/**
 * Health general de la API
 * GET /api/health
 */
router.get(
  "/health",
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      message:
        "RIDS backend TS funcionando ✅",
    });
  }
);

/**
 * Info básica de la API
 * GET /api/info
 */
router.get(
  "/info",
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: "RIDS Backend API",
      version: "1.0.0",
    });
  }
);

/**
 * Rutas de IA
 *
 * /api/ia/chat
 * /api/ia/clear
 */
router.use(
  "/ia",
  iaRouter
);

/**
 * Rutas de contacto
 *
 * /api/contact
 */
router.use(
  "/contact",
  contactRouter
);

/**
 * Analizador Ley 21.719
 *
 * POST /api/analizador/analisis
 * GET  /api/analizador/analisis/:id
 * GET  /api/analizador/salud
 */
router.use(
  "/analizador",
  analizadorRouter
);

export default router;
