import { Request, Response } from "express";
import { runAI } from "../ai/runAI";

export const chat = async (req: Request, res: Response) => {
  try {
    // Extraemos el texto y un sessionId (para que la memoria funcione)
    // Si el front aún no envía sessionId, usamos "default" para no romper nada
    const { text, sessionId = "default-session" } = req.body;

    if (!text) {
      return res.status(400).json({ 
        success: false, 
        error: "El campo 'text' es obligatorio." 
      });
    }

    // Ejecutamos el orquestador único
    const result = await runAI(text, sessionId);

    // Retornamos la respuesta estructurada
    return res.status(200).json(result);

  } catch (error: any) {
    console.error("Error en IA Controller:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Error interno en el proceso de la IA. Intentélo de nuevo mas tarde..." 
    });
  }
};