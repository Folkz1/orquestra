# Orquestra

Plataforma pessoal de inteligencia que captura, transcreve e organiza todas as comunicacoes.

## Features

- **WhatsApp Capture**: Recebe todas as mensagens via Evolution API webhook
- **Audio Transcription**: Transcreve audios automaticamente via Groq Whisper
- **Image Description**: Descreve imagens via OpenRouter Vision (GPT-4o-mini)
- **Meeting Recorder**: PWA instalavel para gravar reunioes (mic + audio do sistema)
- **Daily Briefings**: Briefing diario automatico via Telegram
- **Project Tracking**: Associa mensagens/gravacoes a projetos
- **Full-text Search**: Busca em portugues em todo o conteudo

## Stack

- **Backend**: FastAPI + SQLAlchemy async + asyncpg + PostgreSQL
- **Frontend**: React + Vite + Tailwind CSS + PWA
- **LLM**: OpenRouter (GPT-4o-mini, Claude Sonnet)
- **Audio**: Groq Whisper (free tier)
- **WhatsApp**: Evolution API
- **Deploy**: Docker Compose / EasyPanel

## Quick Start

```bash
# Clone
git clone https://github.com/Folkz1/orquestra.git
cd orquestra

# Config
cp .env.example .env
# Edit .env with your keys

# Run
docker-compose up --build
```

Backend: http://localhost:8000
Frontend: http://localhost:3000
App: http://localhost (via nginx)

## Environment Variables

See `.env.example` for all required variables.

### WhatsApp Assistant (owner-controlled)

A Orquestra agora suporta um modo de assistente para atendimento com rascunhos:

- aprende seu estilo com mensagens anteriores (outgoing)
- gera rascunho de resposta para clientes
- envia só após aprovação (modo seguro)

Documentação: `docs/WHATSAPP_ASSISTANT.md`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/webhook/evolution | Evolution API webhook |
| GET | /api/contacts | List contacts |
| PATCH | /api/contacts/{id} | Update contact |
| GET | /api/messages | List/search messages |
| GET | /api/messages/conversation/{id} | Full conversation |
| POST | /api/recordings/upload | Upload recording |
| GET | /api/recordings | List recordings |
| GET/POST | /api/projects | List/create projects |
| PATCH/DELETE | /api/projects/{id} | Update/delete project |
| GET | /api/briefs | List briefings |
| POST | /api/briefs/generate | Generate briefing |
| GET | /api/health | Health check |

## Deploy (EasyPanel)

1. Push to GitHub
2. Create project "orquestra" in EasyPanel
3. Add services: database (PostgreSQL), backend (Docker), frontend (Docker)
4. Set env vars
5. Configure Evolution API webhook to point to backend URL
