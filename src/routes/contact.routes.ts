import { Router } from "express";
import { handleContactForm } from "../controllers/contact.controller";

const router = Router();

router.post("/", handleContactForm);

export default router;
