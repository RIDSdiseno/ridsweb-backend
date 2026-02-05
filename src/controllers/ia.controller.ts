import { Request, Response } from "express";
import { runAI } from "../ai/runAI";

export const chatWithIA = async (req: Request, res: Response) => {
  try {
    const { text, sessionId = "default" } = req.body;

    // 1. Validación de entrada (Esto DEBE ir primero)
    if (!text) {
      return res.status(400).json({ 
        ok: false, 
        error: "El campo 'text' es obligatorio." 
      });
    }

    // 2. Ejecutamos el cerebro una SOLA vez
    const result = await runAI(text, sessionId);

    // 3. Retornamos la respuesta estructurada que el frontend de RIDS espera
    return res.status(200).json({
      ok: true,
      reply: result.reply,
      thought: result.thought,
      intent: result.intent,   // ✅ Para las reglas de ventas
      action: result.action,   // ✅ Para la redirección (PLANES/SERVICIOS)
      sessionId: sessionId
    });

  } catch (error: any) {
    console.error("Error en IA Controller:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "Error interno en el proceso de la IA." 
    });
  }
};