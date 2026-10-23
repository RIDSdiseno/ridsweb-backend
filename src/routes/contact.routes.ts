// src7routes/contact.routes.ts
import { Router } from "express";

import {
    handleContactForm,
} from "../controllers/contact.controller";

import {
    contactLimiter,
} from "../ai/contactLimiter";

const router = Router();

router.post(
    "/",
    contactLimiter,
    handleContactForm
);

export default router;