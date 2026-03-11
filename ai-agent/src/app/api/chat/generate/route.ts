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
    // Race generateText against a 55s timeout (Vercel/EasyPanel default is 60s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    const result = await generateText({
      model: openrouter(AI_MODEL),
      system: SYSTEM_PROMPT + (phone ? `\n\nEsta conversa é via WhatsApp com o número ${phone}.` : ''),
      messages: allMessages,
      tools: allTools,
      maxSteps: 5,
      abortSignal: controller.signal,
    });

    clearTimeout(timeout);

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
    console.error('[JARBAS] Generate error:', error?.message, error?.cause || '');

    const isTimeout = error?.name === 'AbortError' || error?.message?.includes('abort');
    const friendlyMsg = isTimeout
      ? 'Demorou demais pra processar. Tenta uma pergunta mais direta (ex: "status do João" em vez de "me conta tudo sobre o João").'
      : 'Deu um erro aqui. Tenta de novo em um instante.';

    return Response.json({
      text: friendlyMsg,
      error: error.message,
    }, { status: isTimeout ? 504 : 500 });
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
