# WhatsApp Assistant (Owner-Controlled)

Este módulo adiciona um copiloto para atendimento via WhatsApp dentro da Orquestra, usando OpenRouter.

## Objetivo

- Aprender seu estilo com base nas mensagens **outgoing** já enviadas para clientes.
- Gerar **rascunhos** de resposta primeiro (modo seguro).
- Enviar somente quando você aprovar.

## Segurança

- Não há auto-resposta para clientes no MVP.
- Comandos do assistente são manuais (`/assist ...`).
- Recomendado configurar `OWNER_WHATSAPP` para receber confirmações/preview.

## Variáveis novas

```env
OWNER_WHATSAPP=5551999998888
ASSISTANT_MODE=approval
```

## Endpoints

- `POST /api/assistant/drafts/generate`
  - body: `{ "contact_id" | "phone", "objective": "...", "send_now": false }`
- `GET /api/assistant/drafts?status=generated`
- `POST /api/assistant/drafts/{id}/send`

## Comandos WhatsApp (owner)

- `/assist help`
- `/assist draft <telefone> | <objetivo>`
- `/assist send <draft_id>`

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
