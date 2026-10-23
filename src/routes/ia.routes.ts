// src/routes/ia.routes.ts

import { Router } from "express";

import {
    chatWithIA,
    clearIASession,
} from "../controllers/ia.controller";

import {
    aiLimiter,
} from "../ai/aiLimiter";

const router = Router();

router.post(
    "/chat",
    aiLimiter,
    chatWithIA
);

router.post(
    "/clear",
    aiLimiter,
    clearIASession
);

export default router;