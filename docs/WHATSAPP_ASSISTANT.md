# WhatsApp Assistant (Owner-Controlled)

Este módulo adiciona um copiloto para atendimento via WhatsApp dentro da Orquestra, usando OpenRouter.

## Objetivo

- Aprender seu estilo com base nas mensagens **outgoing** já enviadas para clientes.
- Gerar **rascunhos** de resposta primeiro (modo seguro).
- Enviar somente quando você aprovar.

## Segurança

- Não há auto-resposta para clientes no MVP.
- Comandos do assistente são manuais (`/assist ...`).
- Com `OWNER_WHATSAPP` configurado, existe hard-lock: somente esse número pode executar comandos admin.
- Recomendado usar seu número pessoal como owner e manter o número de trabalho para operação.

## Variáveis novas

```env
OWNER_WHATSAPP=5551999998888
ASSISTANT_MODE=approval
ASSISTANT_CHAT_MODEL=x-ai/grok-4.1-fast
```

## Endpoints

- `POST /api/assistant/drafts/generate`
  - body: `{ "contact_id" | "phone", "objective": "...", "send_now": false }`
- `GET /api/assistant/drafts?status=generated`
- `POST /api/assistant/drafts/{id}/send`

## Conversa em linguagem natural (owner)

Você pode falar normalmente com o bot no seu número owner (sem `/comando`).
Exemplos:

- "me mostra as conversas em aberto"
- "gera resposta pro 5551999998888 pedindo confirmação da reunião"
- "monta um áudio firme pro cliente 5551999998888 fechar hoje"
- "envia o draft 123e4567-..."

Os comandos `/assist ...` continuam funcionando só como fallback técnico.
Modo principal: conversa natural.

Exemplo:

```text
/assist draft 5551991112222 | responder com proposta de próximos passos e valor
```

O bot vai gerar um rascunho e devolver o ID para envio.

## Como funciona o aprendizado de estilo

Na geração de rascunho, o assistente usa:

1. Mensagens outgoing anteriores com o mesmo contato.
2. Se faltar volume, mensagens outgoing globais para outros clientes.
3. Último histórico da conversa com o cliente.

Isso mantém tom, vocabulário e estrutura próximos do seu jeito real de responder.
