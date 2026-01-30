import "dotenv/config";
import { AIMessage, AIPart } from "./ai.types";
import { ANALYSIS_PROMPT } from "./ai.prompts";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? 0.1);

/* ===============================
   Llamada simple a OpenAI
================================ */
async function callOpenAI(messages: any[]): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: AI_TEMPERATURE,
      max_tokens: 300,
      messages,
    }),
  });

  if (!resp.ok) {
    console.error("OpenAI error:", resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

/* ===============================
   Orquestador principal
================================ */
export async function runAI(input: {
  userText: string;
  context?: {
    channel?: string;
    turns?: number;
    email?: string;
    company?: string;
  };
}): Promise<AIMessage> {
  const userText = input.userText?.trim();

  if (!userText) {
    return {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "¿En qué puedo ayudarte? 😊",
        },
      ],
    };
  }

  const messages = [
    { role: "system", content: ANALYSIS_PROMPT },
    { role: "user", content: userText },
  ];

  const raw = await callOpenAI(messages);

  if (!raw) {
    return {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "En este momento no puedo responder 😓. Inténtalo más tarde.",
        },
      ],
    };
  }

  let analysis: any;
  try {
    analysis = JSON.parse(raw);
  } catch (err) {
    console.error("JSON parse error:", raw);
    return {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Tuve un problema entendiendo tu solicitud 😓",
        },
      ],
    };
  }

  const parts: AIPart[] = [];

  /* ===== razonamiento ===== */
  if (analysis.reasoning) {
    parts.push({
      type: "reasoning",
      reasoning: analysis.reasoning,
    });
  }

  /* ===== acción ===== */
  if (analysis.action?.type === "redirect" && analysis.action.target) {
    parts.push({
      type: "tool-call",
      toolName: `REDIRECT:${analysis.action.target}`,
    });
  }

  /* ===== respuesta final ===== */
  parts.push({
    type: "text",
    text:
      analysis.reply ||
      "Gracias por tu mensaje 😊 ¿Te puedo ayudar en algo más?",
  });

  return {
    role: "assistant",
    parts,
  };
}
