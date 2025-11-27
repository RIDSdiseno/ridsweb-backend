// utils/ai.ts
import "dotenv/config";

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

// ===============================
// Cola simple para limitar concurrencia global
// ===============================
// ⚠️ Por defecto 1 llamada en paralelo, para cuidar el RPM=3
const MAX_PARALLEL_CALLS = Number(process.env.AI_MAX_PARALLEL_CALLS || 1);
let activeCalls = 0;
const queue: Array<() => void> = [];

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeCalls++;
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeCalls--;
        const next = queue.shift();
        if (next) {
          // pequeño delay para no reventar el RPM
          setTimeout(next, 150);
        }
      }
    };

    if (activeCalls < MAX_PARALLEL_CALLS) {
      run();
    } else {
      queue.push(run);
    }
  });
}

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

— IMPORTANTE:
   • Solo usa UNA marca [[REDIRECT:...]] por mensaje.
   • La marca debe ir SIEMPRE al inicio de tu respuesta, sin texto antes.
   • El resto de la respuesta debe ser un mensaje amable para el usuario, explicando qué estás haciendo o dándole contexto.
...
`;

// -----------------------------------------------------------------------------
// Llamado a OpenAI con backoff para 429
// -----------------------------------------------------------------------------
async function callOpenAIWithRetry(
  messages: ChatMessage[],
  maxRetries = 1 // 👈 como hay esperas largas (20s+), solo 1 reintento corto
): Promise<{ text: string | null }> {
  if (!OPENAI_API_KEY) {
    return {
      text:
        "Hola 👋 Soy RIDSI, el asistente virtual de la empresa. Cuéntame en qué te puedo ayudar (soporte, ventas o dudas técnicas).",
    };
  }

  let attempt = 0;

  while (true) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: AI_TEMPERATURE,
        // 🔻 Bajar salida para reducir "Requested X tokens"
        max_tokens: 200,
        frequency_penalty: 0.2,
        presence_penalty: 0.0,
        messages,
      }),
    });

    const bodyText = await resp.text().catch(() => "");

    if (resp.ok) {
      const data = JSON.parse(bodyText) as OpenAIChatResponse;

      if (data.usage) {
        console.log(
          `[AI USAGE] prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens} total=${data.usage.total_tokens}`
        );
      }

      const first = data?.choices?.[0];
      const content = (first?.message?.content ?? "") || null;
      return { text: content?.trim() || null };
    }

    // Manejo de errores
    if (resp.status === 429 && attempt < maxRetries) {
      attempt++;

      // Intentamos leer "Please try again in XXs"
      let suggestedDelayMs: number | null = null;
      const match = bodyText.match(/try again in (\d+)s/i);
      if (match) {
        const sec = parseInt(match[1], 10);
        if (!Number.isNaN(sec)) suggestedDelayMs = sec * 1000;
      }

      // Si nos sugieren esperar MUCHO (>= 10s), no vale la pena reintentar
      if (suggestedDelayMs && suggestedDelayMs >= 10000) {
        console.warn(
          `[OpenAI 429] sugerido esperar ${suggestedDelayMs}ms, no reintento para no bloquear al usuario`
        );
        break;
      }

      const delayMs =
        suggestedDelayMs && suggestedDelayMs > 0 ? suggestedDelayMs : 2000;

      console.warn(
        `[OpenAI 429] intento=${attempt} - esperando ${delayMs}ms. Detalle: ${bodyText.slice(
          0,
          200
        )}`
      );
      await new Promise((res) => setTimeout(res, delayMs));
      continue;
    }

    // Otros errores o ya sin reintentos
    console.error("OpenAI error:", resp.status, bodyText);
    return { text: null };
  }
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

  // Usar transcript recortado para no explotar tokens
  const transcript = input.context?.transcript || [];
  const transcriptLines = transcript
    .map((t) => `${t.from === "client" ? "Usuario" : "RIDSI"}: ${t.text}`)
    .join("\n");

  // 🔻 Reducimos bastante el historial, antes tenías prompts de ~740 tokens
  const transcriptMaxChars = 1000;
  const trimmedTranscript =
    transcriptLines.length > transcriptMaxChars
      ? transcriptLines.slice(transcriptLines.length - transcriptMaxChars)
      : transcriptLines;

  const historyBlock = trimmedTranscript
    ? `Historial reciente de la conversación (puede estar truncado):\n${trimmedTranscript}\n\n`
    : "";

  const userContent = `
${historyBlock}Mensaje actual del usuario:
${user}${prev}${prevBot}
`.trim();

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  try {
    // Pasamos por la cola para limitar concurrencia
    const { text } = await enqueue(() => callOpenAIWithRetry(messages));

    if (text && text.length > 0) {
      return text;
    }

    // Aquí llegas cuando: 429 con espera larga, o error raro
    return "En este momento estamos usando mucha capacidad de la IA y no puedo responderte bien 😓. Intenta nuevamente en unos minutos o escríbenos a soporte@rids.cl.";
  } catch (err) {
    console.error("[runAI ERROR]", err);
    return "Tuve un problema procesando tu mensaje 😓. ¿Lo intentamos de nuevo en unos instantes?";
  }
}
