/**
 * Jarbas AI Generate Endpoint (non-streaming)
 * Used by WhatsApp webhook for synchronous responses.
 *
 * POST /api/chat/generate
 * Body: { message: string, session_id?: string, phone?: string }
 */

import type { CoreMessage } from 'ai';

import { AI_MODEL, OPENROUTER_API_KEY } from '@/lib/config';
import { addMessages, getMessages } from '@/lib/memory';
import { SYSTEM_PROMPT } from '@/lib/system-prompt';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function normalizeMessages(messages: CoreMessage[]) {
  return messages
    .map((message) => {
      const content =
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : ''))
                .join('\n')
            : '';

      return {
        role: message.role,
        content,
      };
    })
    .filter((message) => message.content.trim());
}

export async function POST(req: Request) {
  const body = await req.json();
  const userMessage: string = body.message || '';
  const sessionId: string = body.session_id || body.phone || 'whatsapp';
  const phone: string = body.phone || '';

  if (!userMessage.trim()) {
    return Response.json({ error: 'Empty message' }, { status: 400 });
  }

  if (!OPENROUTER_API_KEY) {
    return Response.json({ text: 'OPENROUTER_API_KEY nao configurada.' }, { status: 500 });
  }

  const history = getMessages(sessionId);
  const newMessage: CoreMessage = { role: 'user', content: userMessage };
  const allMessages = normalizeMessages([...history, newMessage]);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT + (phone ? `\n\nEsta conversa e via WhatsApp com o numero ${phone}.` : ''),
          },
          ...allMessages,
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return Response.json(
        {
          text: 'Deu um erro aqui. Tenta de novo em um instante.',
          error: errorText || `OpenRouter ${response.status}`,
        },
        { status: response.status || 500 }
      );
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content?.trim() || 'Sem resposta textual.'

    addMessages(sessionId, [newMessage]);
    addMessages(sessionId, [{ role: 'assistant', content: text } as CoreMessage]);

    return Response.json({
      text,
      toolsUsed: [],
      session_id: sessionId,
    });
  } catch (error: any) {
    return Response.json(
      {
        text: 'Deu um erro aqui. Tenta de novo em um instante.',
        error: error?.message || 'Unexpected error',
      },
      { status: 500 }
    );
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
