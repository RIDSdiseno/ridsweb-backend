// src/routes/ia.routes.ts
import { Router } from "express";
import { iaChat, iaHealth } from "../controllers/ia.controller";

const router = Router();

// para la página (chat web)
router.post("/chat", iaChat);
router.get("/health", iaHealth);

export default router;
