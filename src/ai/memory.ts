type Message = { role: "user" | "assistant"; content: string };

// Diccionario de sesiones: { "session-1": [mensajes], "session-2": [mensajes] }
const storage: Record<string, Message[]> = {};

export const getHistory = (sessionId: string): Message[] => {
  // Retornamos los últimos 10 mensajes para no saturar a la IA
  return storage[sessionId]?.slice(-10) || [];
};

export const saveMessage = (sessionId: string, role: "user" | "assistant", content: string) => {
  if (!storage[sessionId]) {
    storage[sessionId] = [];
  }
  storage[sessionId].push({ role, content });
  
  // Limpieza: Si la conversación es muy larga, borramos lo viejo
  if (storage[sessionId].length > 20) {
    storage[sessionId].shift();
  }
};