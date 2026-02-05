import { Router } from "express";
import { chatWithIA } from "../controllers/ia.controller"; // <-- Verifica que este nombre coincida

const router = Router();

// La ruta POST que llama a tu función
router.post("/chat", chatWithIA);

export default router;