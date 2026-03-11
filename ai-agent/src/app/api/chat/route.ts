/**
 * Jarbas AI Chat Endpoint
 * Streaming chat with Vercel AI SDK + tools.
 *
 * POST /api/chat
 * Body: { messages: [...], session_id?: string }
 *
 * Used by:
 * - Frontend chat UI (streaming)
 * - WhatsApp webhook (non-streaming via generateText)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type CoreMessage } from 'ai';

import { AI_MODEL, OPENROUTER_API_KEY } from '@/lib/config';
import { getMessages, addMessages } from '@/lib/memory';
import { SYSTEM_PROMPT } from '@/lib/system-prompt';
import { allTools } from '@/lib/tools';

const openrouter = createOpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

export async function POST(req: Request) {
  const body = await req.json();
  const incomingMessages: CoreMessage[] = body.messages || [];
  const sessionId: string = body.session_id || 'default';

  // Build full conversation: session history + new messages
  const history = getMessages(sessionId);
  const allMessages = [...history, ...incomingMessages];

  const result = streamText({
    model: openrouter(AI_MODEL),
    system: SYSTEM_PROMPT,
    messages: allMessages,
    tools: allTools,
    maxSteps: 8,
    onFinish: async ({ response }) => {
      // Save all new messages to session memory
      addMessages(sessionId, incomingMessages);
      // Save assistant response messages
      for (const msg of response.messages) {
        addMessages(sessionId, [msg]);
      }
    },
  });

  return result.toDataStreamResponse();
}

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
