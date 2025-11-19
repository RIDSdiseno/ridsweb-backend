// src/controllers/ia.controller.ts
import type { Request, Response } from "express";
import { runAI } from "../utils/ai";

// =====================
// Tipos de sesión
// =====================

type TranscriptItem = { from: "client" | "bot"; text: string };

type SessionMem = {
  lastUserMsg?: string;
  lastAIReply?: string;
  lastAt?: number;
  turns?: number;
  email?: string;
  company?: string;
  name?: string;
  transcript?: TranscriptItem[];
};

const sessionMemory = new Map<string, SessionMem>();

const MAX_TEXT_LEN = Number(process.env.MAX_TEXT_LEN || 1200);
const PER_USER_MIN_INTERVAL_MS = Number(
  process.env.PER_USER_MIN_INTERVAL_MS || 400
);
const MAX_TRANSCRIPT_ITEMS = 30;

function rid() {
  return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Email (para extraer si el usuario lo menciona)
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Heurística para extraer empresa del texto
function extractCompanyFromText(text: string): string | undefined {
  const patterns = [
    /(?:mi\s+empresa\s+es|la\s+empresa\s+es|somos\s+de|soy\s+de|trabajo\s+en|de\s+la\s+empresa)\s+([a-z0-9áéíóúüñ .&_-]{2,80})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().replace(/[.,;]$/, "");
  }
  return undefined;
}

// Heurística simple para extraer nombre del usuario
function extractNameFromText(text: string): string | undefined {
  const patterns = [
    /(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+([a-záéíóúüñ ]{2,40})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const name = m[1].trim().replace(/[.,;]$/, "");
      return name
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return undefined;
}

/**
 * POST /api/ia/chat
 * Body:
 *  - sessionId?: string
 *  - text: string
 *  - channel?: string
 */
export const iaChat = async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    let { sessionId, text, channel } = req.body as {
      sessionId?: string;
      text?: string;
      channel?: string;
    };

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Falta 'text' en el body",
      });
    }

    text = text.trim();
    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "El mensaje está vacío",
      });
    }

    if (text.length > MAX_TEXT_LEN) {
      text = text.slice(0, MAX_TEXT_LEN);
    }

    // Generar sessionId si no viene
    if (!sessionId) {
      sessionId = rid();
    }

    const now = Date.now();
    const mem = sessionMemory.get(sessionId) || {};

    // rate limit simple por sesión
    if (mem.lastAt && now - mem.lastAt < PER_USER_MIN_INTERVAL_MS) {
      return res.status(429).json({
        ok: false,
        error:
          "Demasiadas solicitudes seguidas, intenta nuevamente en unos segundos.",
      });
    }

    const turns = (mem.turns ?? 0) + 1;

    // Extraer email / empresa / nombre
    const emailFound = text.match(EMAIL_RE)?.[0] ?? undefined;
    let email = mem.email ?? emailFound;

    let company = mem.company;
    if (!company) {
      const c = extractCompanyFromText(text);
      if (c) company = c;
    }

    let name = mem.name;
    if (!name) {
      const n = extractNameFromText(text);
      if (n) name = n;
    }

    const prevTranscript: TranscriptItem[] = mem.transcript || [];
    const trimmedPrevTranscript =
      prevTranscript.length > MAX_TRANSCRIPT_ITEMS
        ? prevTranscript.slice(-MAX_TRANSCRIPT_ITEMS)
        : prevTranscript;

    const transcriptForAI: TranscriptItem[] = [
      ...trimmedPrevTranscript,
      { from: "client", text },
    ];

    const context = {
      from: sessionId,
      sessionId,
      turns,
      email,
      company,
      name,
      transcript: transcriptForAI,
      lastUserMsg: mem.lastUserMsg,
      lastAIReply: mem.lastAIReply,
      channel: channel || "web",
    };

    let reply: string;
    try {
      reply = (await runAI({ userText: text, context })) || "";
    } catch (err) {
      console.error("[IA ERROR]", err);
      reply =
        "Tuve un problema procesando tu mensaje 😓. ¿Podemos intentarlo de nuevo en unos instantes?";
    }

    if (!reply.trim()) {
      reply =
        "Por ahora no puedo responder bien tu mensaje, pero puedes escribir a soporte@rids.cl 😊";
    }

    // 🧹 Post-proceso: si no es el primer turno, evitamos saludos repetidos con "hola soy RIDSI..."
    if (turns > 1) {
      reply = reply
        .replace(
          /(^\s*¡?hola[^.\n]*ridsi[^.\n]*[.!]?\s*)/i,
          ""
        )
        .trim();

      if (!reply) {
        reply =
          "Entiendo, cuéntame un poco más para poder ayudarte mejor.";
      }
    }

    // 👇 Detectar posible redirección marcada por la IA
    let redirectTo: string | null = null;

    // Busca marcas como [[REDIRECT:PLANES]], [[REDIRECT:SERVICIOS]], etc.
    const redirectMatch = reply.match(/^\s*\[\[REDIRECT:([A-Z_]+)\]\]/);

    if (redirectMatch) {
      const code = redirectMatch[1]; // PLANES, SERVICIOS, SOBRE_NOSOTROS, FOOTER...

      // Mapeo a claves más amigables para el front
      switch (code) {
        case "PLANES":
          redirectTo = "planes";
          break;
        case "SERVICIOS":
        case "SERVICES":
          redirectTo = "servicios";
          break;
        case "SOBRE_NOSOTROS":
          redirectTo = "sobreNosotros";
          break;
        case "FOOTER":
          redirectTo = "footer";
          break;
        default:
          redirectTo = null;
      }

      // Quitar la marca del texto que verá el usuario
      reply = reply.replace(/^\s*\[\[REDIRECT:[A-Z_]+\]\]\s*/i, "").trim();

      if (!reply) {
        reply =
          "Perfecto, te llevo a esa sección para que veas más detalle.";
      }
    }

    // Actualizar memoria
    const newTranscript: TranscriptItem[] = [
      ...trimmedPrevTranscript,
      { from: "client", text },
      { from: "bot", text: reply },
    ];

    const nextMem: SessionMem = {
      lastUserMsg: text,
      lastAIReply: reply,
      lastAt: now,
      turns,
      email,
      company,
      name,
      transcript: newTranscript,
    };

    sessionMemory.set(sessionId, nextMem);

    console.log(
      `[IA CHAT] session=${sessionId} turns=${turns} latency=${
        Date.now() - t0
      }ms redirectTo=${redirectTo ?? "none"}`
    );

    return res.json({
      ok: true,
      sessionId,
      reply,
      turns,
      redirectTo, // 👈 para que el front sepa dónde redirigir
    });
  } catch (err) {
    console.error("[IA CHAT ERROR]", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};

export const iaHealth = (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "ia-web-chat" });
};
