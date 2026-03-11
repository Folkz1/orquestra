/**
 * Simple in-memory conversation store.
 * Each session (identified by session_id) keeps its message history.
 * In production, this should be persisted to DB.
 */

import type { CoreMessage } from 'ai';

const sessions = new Map<string, { messages: CoreMessage[]; updatedAt: number }>();

const MAX_MESSAGES = 50;
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

export function getMessages(sessionId: string): CoreMessage[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  // Check TTL
  if (Date.now() - session.updatedAt > SESSION_TTL) {
    sessions.delete(sessionId);
    return [];
  }
  return session.messages;
}

export function addMessage(sessionId: string, message: CoreMessage) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], updatedAt: Date.now() };
    sessions.set(sessionId, session);
  }
  session.messages.push(message);
  session.updatedAt = Date.now();
  // Trim old messages
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
}

export function addMessages(sessionId: string, msgs: CoreMessage[]) {
  for (const m of msgs) {
    addMessage(sessionId, m);
  }
}

export function clearSession(sessionId: string) {
  sessions.delete(sessionId);
}

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000);
