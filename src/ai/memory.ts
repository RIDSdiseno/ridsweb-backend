// src/ai/memory.ts
type Message = {
  role: "user" | "assistant";
  content: string;
};

type SessionMemory = {
  messages: Message[];
  lastActivity: number;
};

const storage =
  new Map<string, SessionMemory>();

const SESSION_TTL_MS =
  30 * 60 * 1000;

const MAX_MESSAGES = 20;

function cleanupExpiredSessions() {
  const now = Date.now();

  for (
    const [sessionId, session]
    of storage.entries()
  ) {
    if (
      now - session.lastActivity >
      SESSION_TTL_MS
    ) {
      storage.delete(sessionId);
    }
  }
}

export const getHistory = (
  sessionId: string
): Message[] => {
  cleanupExpiredSessions();

  const session =
    storage.get(sessionId);

  if (!session) {
    return [];
  }

  if (
    Date.now() -
    session.lastActivity >
    SESSION_TTL_MS
  ) {
    storage.delete(sessionId);

    return [];
  }

  session.lastActivity =
    Date.now();

  return session.messages.slice(-10);
};

export const saveMessage = (
  sessionId: string,
  role: "user" | "assistant",
  content: string
) => {
  cleanupExpiredSessions();

  let session =
    storage.get(sessionId);

  if (!session) {
    session = {
      messages: [],
      lastActivity:
        Date.now(),
    };

    storage.set(
      sessionId,
      session
    );
  }

  session.messages.push({
    role,
    content,
  });

  session.lastActivity =
    Date.now();

  if (
    session.messages.length >
    MAX_MESSAGES
  ) {
    session.messages =
      session.messages.slice(
        -MAX_MESSAGES
      );
  }
};

export const clearHistory = (
  sessionId: string
) => {
  storage.delete(sessionId);
};