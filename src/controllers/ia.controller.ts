import { Request, Response } from "express";
import { runAI } from "../ai/runAI";

// Usamos "chatWithIA" como nombre de la función
export const chatWithIA = async (req: Request, res: Response) => {
  try {
    const { text, sessionId } = req.body; // [cite: 24, 25]

    // Ejecutamos la lógica del cerebro
    const result = await runAI(text, sessionId);

    // Retornamos el JSON que el frontend espera (con el campo "ok") [cite: 27]
    return res.json({
      ok: true,
      reply: result.reply,
      thought: result.thought,
      sessionId: sessionId
    });
  } catch (error) {
    console.error("Error en ia.controller:", error);
    return res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
};