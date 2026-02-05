import { openai } from "./ai.client";
import { getHistory, saveMessage } from "./memory";
// 1. IMPORTACIÓN: Traemos el manual de 8 reglas
import { ANALYSIS_PROMPT } from "../utils/ai.prompts"; 

export async function runAI(userText: string, sessionId: string = "default") {
  
  console.log("🔍 RECIBIDO EN BACKEND -> sessionId:", sessionId, "| texto:", userText);
  
  const history = getHistory(sessionId);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", 
      messages: [
        {
          role: "system",
          // 2. INYECCIÓN: Reemplazamos el texto genérico por tu manual proactivo
          content: ANALYSIS_PROMPT 
        },
        ...history,
        { role: "user", content: userText }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");

    saveMessage(sessionId, "user", userText);
    saveMessage(sessionId, "assistant", response.choices[0].message.content || "");

    // 3. RETORNO: Agregamos intent y action para que el front reciba la orden
    return {
      success: true,
      thought: result.reasoning || result.thought, 
      reply: result.reply,
      intent: result.intent, // Necesario para lógica de ventas
      action: result.action  // Contiene el 'target': 'PLANES' o 'SERVICIOS'
    };

  } catch (error) {
    console.error("Fallo en el cerebro:", error);
    return { success: false, reply: "Hubo un cortocircuito en mi lógica... Necesito recargarme 😛" };
  }
}