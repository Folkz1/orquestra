/**
 * Jarbas AI Chat Endpoint
 * Streaming chat using OpenRouter directly.
 *
 * POST /api/chat
 * Body: { messages: [...], session_id?: string }
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
  const incomingMessages: CoreMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const sessionId: string = body.session_id || 'default';
  const history = getMessages(sessionId);
  const allMessages = normalizeMessages([...history, ...incomingMessages]);

  if (!OPENROUTER_API_KEY) {
    return new Response('3:{"message":"OPENROUTER_API_KEY nao configurada"}\n', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  }

  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...allMessages,
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text().catch(() => '');
    return new Response(
      `3:${JSON.stringify({ message: errorText || `OpenRouter ${upstream.status}` })}\n`,
      {
        status: upstream.status || 500,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let assistantText = '';
  let upstreamDone = false;

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';

      const flushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;

        const payload = trimmed.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') {
          upstreamDone = true;
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (!delta) return;

          assistantText += delta;
          controller.enqueue(encoder.encode(`0:${JSON.stringify(delta)}\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(`3:${JSON.stringify({ message: error instanceof Error ? error.message : 'Falha ao processar stream' })}\n`)
          );
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            flushLine(line);
          }
        }

        if (buffer.trim()) {
          flushLine(buffer);
        }

        addMessages(sessionId, incomingMessages);
        if (assistantText.trim()) {
          addMessages(sessionId, [{ role: 'assistant', content: assistantText } as CoreMessage]);
        }

        if (!upstreamDone) {
          controller.enqueue(encoder.encode('d:{}\n'));
        } else {
          controller.enqueue(encoder.encode('d:{}\n'));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(`3:${JSON.stringify({ message: error instanceof Error ? error.message : 'Falha ao conversar com Jarbas' })}\n`)
        );
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
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
