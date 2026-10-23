// src/ai/runAI.ts
import {
  openai,
} from "./ai.client";

import {
  getHistory,
  saveMessage,
} from "./memory";

import {
  ANALYSIS_PROMPT,
} from "../utils/ai.prompts";

type AIResult = {
  reply?: string;

  intent?:
  | "ventas"
  | "soporte"
  | "info"
  | "otro";

  action?: {
    type:
    | "redirect"
    | "none";

    target?:
    | "PLANES"
    | "SERVICIOS"
    | "SOBRE_NOSOTROS"
    | "FOOTER";
  };

  reasoning?: string;
};

export async function runAI(
  userText: string,
  sessionId: string
) {
  const history =
    getHistory(sessionId);

  try {
    const response =
      await openai.chat.completions.create({
        model:
          process.env.OPENAI_MODEL ||
          "gpt-4o",

        messages: [
          {
            role: "system",
            content:
              ANALYSIS_PROMPT,
          },

          ...history,

          {
            role: "user",
            content:
              userText,
          },
        ],

        response_format: {
          type: "json_object",
        },
      });

    const rawContent =
      response.choices[0]
        ?.message
        ?.content;

    if (!rawContent) {
      throw new Error(
        "La IA no devolvió contenido."
      );
    }

    const result: AIResult =
      JSON.parse(rawContent);

    const reply =
      typeof result.reply === "string" &&
        result.reply.trim()
        ? result.reply.trim()
        : "No pude generar una respuesta en este momento.";

    saveMessage(
      sessionId,
      "user",
      userText
    );

    // Sólo respuesta visible.
    saveMessage(
      sessionId,
      "assistant",
      reply
    );

    return {
      success: true,
      reply,

      intent:
        result.intent ||
        "otro",

      action:
        result.action || {
          type: "none",
        },
    };
  } catch (error) {
    console.error(
      "[AI] Error:",
      error instanceof Error
        ? error.message
        : "Error desconocido"
    );

    return {
      success: false,

      reply:
        "No pude procesar tu consulta en este momento. Intenta nuevamente más tarde.",

      intent: "otro",

      action: {
        type: "none",
      },
    };
  }
}