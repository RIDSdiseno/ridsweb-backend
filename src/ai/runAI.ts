import { openai } from "./ai.client";
import { getHistory, saveMessage } from "./memory";


export async function runAI(userText: string, sessionId: string = "default") {
  
  console.log("🔍 RECIBIDO EN BACKEND -> sessionId:", sessionId, "| texto:", userText);
  
  // 1. Recuperamos el pasado (lo que estaba en memory.ts)
  const history = getHistory(sessionId);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // O "gpt-4o-mini" para que sea más barato y rápido
      messages: [
        {
          role: "system",
          content: `Eres un asesor técnico de alto nivel. 
          Debes analizar el historial para dar respuestas coherentes.
          Responde SIEMPRE en formato JSON:
          {
            "thought": "Análisis interno de lo que el usuario quiere",
            "reply": "Tu respuesta directa"
          }`
        },
        ...history,
        { role: "user", content: userText }
      ],
      response_format: { type: "json_object" }
    });

const result = JSON.parse(response.choices[0].message.content || "{}");

    // 1. Guardamos el mensaje del usuario (Normal)
    saveMessage(sessionId, "user", userText);

    // 2. VITAL: Guardamos la respuesta tal cual la generó la IA (en JSON)
    // para que en la próxima vuelta vea que ha sido coherente con el formato.
    saveMessage(sessionId, "assistant", response.choices[0].message.content || "");

    return {
      success: true,
      thought: result.thought,
      reply: result.reply
    };

  } catch (error) {
    console.error("Fallo en el cerebro:", error);
    return { success: false, reply: "Hubo un cortocircuito en mi lógica. Me estoy recargando..." };
  }
}