// src/controllers/ia.controller.ts
import type {
  Request,
  Response,
} from "express";

import {
  runAI,
} from "../ai/runAI";

import {
  clearHistory,
} from "../ai/memory";

const MAX_MESSAGE_LENGTH =
  2000;

const SESSION_ID_REGEX =
  /^[a-zA-Z0-9_-]{10,100}$/;

export const chatWithIA =
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const text =
        typeof req.body?.text ===
          "string"
          ? req.body.text.trim()
          : "";

      const sessionId =
        typeof req.body?.sessionId ===
          "string"
          ? req.body.sessionId.trim()
          : "";

      if (!text) {
        return res.status(400).json({
          ok: false,
          error:
            "El mensaje es obligatorio.",
        });
      }

      if (
        text.length >
        MAX_MESSAGE_LENGTH
      ) {
        return res.status(400).json({
          ok: false,

          error:
            `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.`,
        });
      }

      if (
        !sessionId ||
        !SESSION_ID_REGEX.test(
          sessionId
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "La sesión de conversación no es válida.",
        });
      }

      const result =
        await runAI(
          text,
          sessionId
        );

      if (!result.success) {
        return res.status(503).json({
          ok: false,
          error:
            result.reply,
        });
      }

      return res.status(200).json({
        ok: true,

        reply:
          result.reply,

        intent:
          result.intent,

        action:
          result.action,

        sessionId,
      });
    } catch (error) {
      console.error(
        "[IA Controller]",
        error instanceof Error
          ? error.message
          : "Error desconocido"
      );

      return res.status(500).json({
        ok: false,
        error:
          "Error interno en el proceso de la IA.",
      });
    }
  };

export const clearIASession =
  async (
    req: Request,
    res: Response
  ) => {
    const sessionId =
      typeof req.body?.sessionId ===
        "string"
        ? req.body.sessionId.trim()
        : "";

    if (
      !sessionId ||
      !SESSION_ID_REGEX.test(
        sessionId
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "La sesión de conversación no es válida.",
      });
    }

    clearHistory(
      sessionId
    );

    return res.status(200).json({
      ok: true,
    });
  };