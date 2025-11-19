// utils/ai.ts
import "dotenv/config";

// Si usas Node < 18, descomenta estas 2 líneas:
// import fetch from "node-fetch";
// (globalThis as any).fetch = fetch;

export type RunAIInput = {
  userText: string;
  context?: {
    from: string; // id/teléfono/identificador de origen
    lastUserMsg?: string;
    lastAIReply?: string;
    turns?: number;
    email?: string;
    company?: string;
    name?: string;
    phone?: string;
    transcript?: Array<{ from: "client" | "bot"; text: string }>;
    channel?: string; // ej: "whatsapp" | "web"
  };
};

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type OpenAIChatChoice = {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
  };
  finish_reason?: string;
};

type OpenAIChatResponse = {
  id: string;
  object: string; // "chat.completion"
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const PROVIDER = process.env.AI_PROVIDER || "openai";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? 0.2);

// -----------------------------------------------------------------------------
// PROMPT DE CONTROL (SOLO CHAT, SIN TICKETS)
// -----------------------------------------------------------------------------
const BASE_SYSTEM_PROMPT = `
Eres RIDSI, un asistente virtual de RIDS (Soporte y Soluciones Computacionales), una empresa de TI en Chile cuyo sitio web es https://rids.cl.

...

Redirecciones dentro del sitio (frontend):
— Puedes sugerir llevar al usuario a distintas secciones de la página, pero SIEMPRE debes pedir permiso antes.
— Solo debes activar una redirección cuando el usuario lo autorice claramente (por ejemplo: "sí", "llévame", "muéstrame los planes", "quiero ver los servicios", etc.).

Códigos de redirección disponibles:
— [[REDIRECT:PLANES]]       → Sección / componente de planes (Planes.jsx).
— [[REDIRECT:SERVICIOS]]    → Sección / componente de servicios (Servicios.jsx o Services.jsx).
— [[REDIRECT:SOBRE_NOSOTROS]] → Sección / componente de sobre nosotros (SobreNosotros.jsx).
— [[REDIRECT:FOOTER]]       → Pie de página / contacto (Footer.jsx).

Reglas de uso:
1) Si el usuario pregunta o dice algo como "quiero ver los planes", "muéstrame los planes":
   — Explícale brevemente los planes.
   — Pregúntale: "¿Quieres que te lleve a la sección de planes en la página para ver más detalle?"
   — SOLO si responde que sí, en tu siguiente mensaje agrega al inicio:
        [[REDIRECT:PLANES]]
      y luego un mensaje normal, por ejemplo:
        "Perfecto, te llevo a la sección de planes para que revises el detalle."

2) Si el usuario pide ver "servicios", "qué hacemos", etc.:
   — Explica brevemente los servicios.
   — Pregunta si quiere ir a la sección de servicios.
   — Si acepta, usa:
        [[REDIRECT:SERVICIOS]]

3) Si el usuario quiere "sobre nosotros", "quiénes son", "quiénes somos":
   — Explica brevemente quiénes son.
   — Pregunta si quiere ir a la sección Sobre Nosotros.
   — Si acepta, usa:
        [[REDIRECT:SOBRE_NOSOTROS]]

4) Si el usuario quiere "contacto", "correo", "formulario", "datos de contacto":
   — Dale la info básica si la conoces y ofrece llevarlo al footer.
   — Si acepta, usa:
        [[REDIRECT:FOOTER]]

— IMPORTANTE:
   • Solo usa UNA marca [[REDIRECT:...]] por mensaje.
   • La marca debe ir SIEMPRE al inicio de tu respuesta, sin texto antes.
   • El resto de la respuesta debe ser un mensaje amable para el usuario, explicando qué estás haciendo o dándole contexto.
...
`;


// -----------------------------------------------------------------------------
// Llamado a OpenAI
// -----------------------------------------------------------------------------
async function callOpenAI(messages: ChatMessage[]) {
  if (!OPENAI_API_KEY) {
    return {
      text:
        "Hola 👋 Soy RIDSI, el asistente virtual de la empresa. Cuéntame en qué te puedo ayudar (soporte, ventas o dudas técnicas).",
    };
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: AI_TEMPERATURE,
      max_tokens: 320,
      frequency_penalty: 0.2,
      presence_penalty: 0.0,
      messages,
      // 👇 Importante: sin tools, solo conversación
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("OpenAI error:", resp.status, t);
    return { text: null as string | null };
  }

  const data = (await resp.json()) as OpenAIChatResponse;
  const first = data?.choices?.[0];
  const content = (first?.message?.content ?? "") || null;
  return { text: content?.trim() || null };
}

// -----------------------------------------------------------------------------
// Orquestación principal
// -----------------------------------------------------------------------------
export async function runAI(input: RunAIInput): Promise<string> {
  if (PROVIDER !== "openai") {
    throw new Error(`Proveedor IA no soportado: ${PROVIDER}`);
  }

  const user = input.userText?.trim() || "";
  const turns = input.context?.turns ?? 1;
  const email = input.context?.email;
  const company = input.context?.company;
  const channel = input.context?.channel || "chat";

  const prev = input.context?.lastUserMsg
    ? `\n[prev_user]: ${input.context.lastUserMsg}`
    : "";
  const prevBot = input.context?.lastAIReply
    ? `\n[prev_bot]: ${input.context.lastAIReply}`
    : "";

  const escalateLine =
    turns >= 10
      ? "\nSi la conversación suma 10 turnos o más, puedes sugerir amablemente que el usuario contacte a un ejecutivo humano por los canales oficiales de la empresa."
      : "";

  const sessionFacts = `
Contexto de sesión:
— Canal: ${channel}
— Turnos: ${turns}
— Correo del usuario (si se conoce): ${email ? email : "(no especificado)"}
— Empresa del usuario (si se conoce): ${company ? company : "(no especificada)"}
${escalateLine}
`;

  const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}
${sessionFacts}
`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${user}${prev}${prevBot}` },
  ];

  try {
    const { text } = await callOpenAI(messages);

    if (text && text.length > 0) {
      return text;
    }

    return "Tuve un problema procesando tu mensaje 😓. ¿Lo intentamos de nuevo? (puedes contarme si es soporte, ventas o una duda técnica)";
  } catch (err) {
    console.error("[runAI ERROR]", err);
    return "Tuve un problema procesando tu mensaje 😓. ¿Lo intentamos de nuevo en unos instantes?";
  }
}
