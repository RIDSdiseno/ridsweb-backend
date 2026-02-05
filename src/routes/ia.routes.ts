import { Router } from "express";
import { chat } from "../controllers/ia.controller";

const router = Router();

// Definimos el endpoint de chat
// POST /api/ia/chat
router.post("/chat", chat);

export default router;