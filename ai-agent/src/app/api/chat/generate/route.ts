/**
 * Jarbas AI Generate Endpoint (non-streaming)
 * Used by WhatsApp webhook for synchronous responses.
 *
 * POST /api/chat/generate
 * Body: { message: string, session_id?: string, phone?: string }
 * Returns: { text: string, toolResults: [...] }
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type CoreMessage } from 'ai';

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
  const userMessage: string = body.message || '';
  const sessionId: string = body.session_id || body.phone || 'whatsapp';
  const phone: string = body.phone || '';

  if (!userMessage.trim()) {
    return Response.json({ error: 'Empty message' }, { status: 400 });
  }

  // Build conversation with history
  const history = getMessages(sessionId);
  const newMessage: CoreMessage = { role: 'user', content: userMessage };
  const allMessages = [...history, newMessage];

  try {
    const result = await generateText({
      model: openrouter(AI_MODEL),
      system: SYSTEM_PROMPT + (phone ? `\n\nEsta conversa é via WhatsApp com o número ${phone}.` : ''),
      messages: allMessages,
      tools: allTools,
      maxSteps: 8,
    });

    // Save to session memory
    addMessages(sessionId, [newMessage]);
    for (const msg of result.response.messages) {
      addMessages(sessionId, [msg]);
    }

    // Collect tool results for transparency
    const toolsUsed = result.steps
      .flatMap(s => s.toolResults || [])
      .map((tr: any) => ({
        tool: tr.toolName,
        result: typeof tr.result === 'string' ? tr.result.slice(0, 200) : JSON.stringify(tr.result).slice(0, 200),
      }));

    return Response.json({
      text: result.text,
      toolsUsed,
      session_id: sessionId,
    });
  } catch (error: any) {
    console.error('[JARBAS] Generate error:', error);
    return Response.json({
      text: 'Deu um erro aqui. Tenta de novo em um instante.',
      error: error.message,
    }, { status: 500 });
  }
}

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
