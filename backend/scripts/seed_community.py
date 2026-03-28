"""Seed community with initial posts and resources."""
import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

DB_URL = "postgresql+asyncpg://postgres:c56d0e4d3c613eb66684@72.60.13.22:3030/orquestra"

POSTS = [
    {
        "author_name": "Diego",
        "author_role": "admin",
        "content_md": "# Bem-vindos a Comunidade GuyFolkz!\n\nSe voce ta aqui, e porque quer construir coisas reais com IA. Nao tutorial generico, nao teoria. Producao real, com clientes reais, gerando receita real.\n\nAqui voce vai ter acesso a tudo que eu uso no dia a dia:\n- Stack completa do Claude Code (skills, hooks, harness)\n- Agent Lab (teste de agentes com tools)\n- Pipeline Remotion (producao de video com codigo)\n- E tudo que eu for descobrindo e validando\n\nPosta tuas duvidas, compartilha teu progresso, e vamos evoluir juntos.\n\nAbraco!",
        "post_type": "announcement",
        "pinned": True,
    },
    {
        "author_name": "Diego",
        "author_role": "admin",
        "content_md": "## Como usar o Agent Lab\n\nO Agent Lab e o sistema que eu uso pra testar agentes de IA antes de colocar em producao. Ele tem:\n\n1. **ChatLab**: dashboard pra conversar com o agente e ver tool calls em tempo real\n2. **Test Scenarios**: 8 cenarios automatizados por agente\n3. **Tool Marketplace**: browse e teste individual de cada tool\n4. **Cost Tracking**: custo por mensagem ($0.001)\n\nO template completo ta na aba Recursos. Baixa, configura, e me manda tuas duvidas aqui.",
        "post_type": "resource",
        "pinned": False,
    },
    {
        "author_name": "Diego",
        "author_role": "admin",
        "content_md": "## Pipeline Remotion: primeiros passos\n\nEu edito todos os videos do canal com React (Remotion). O pipeline:\n\n1. Gravo o bruto com OBS\n2. Claude Code transcreve com Groq Whisper\n3. Gera overlays automaticamente\n4. Render farm no Contabo (8 CPUs)\n5. Upload pro YouTube via API\n\nSem Premiere, sem DaVinci, sem CapCut. Tudo com codigo.\n\nO template ta nos Recursos. Inclui: componentes, render farm setup, e o teleprompter que uso pra gravar.",
        "post_type": "resource",
        "pinned": False,
    },
    {
        "author_name": "Diego",
        "author_role": "admin",
        "content_md": "## Harness de Programacao: o que e e como usar\n\nSkills sao prompts. Pra producao, tu precisa de trilhos deterministicos. Isso e um Harness.\n\nO conceito: em vez de confiar que o LLM vai acertar 100% das vezes, tu cria um pipeline com gates de validacao. Cada etapa verifica o output antes de passar pra proxima.\n\nExemplo real: meu orchestrator.mjs tem Sprint Contract, REFINE/PIVOT, e VERIFY obrigatorio. Se o agente erra, o pipeline detecta e corrige automaticamente.\n\nVou postar mais detalhes sobre cada gate nos proximos dias.",
        "post_type": "discussion",
        "pinned": False,
    },
]

RESOURCES = [
    {
        "title": "Agent Lab (ChatLab + Tools Framework)",
        "description": "Template completo do sistema de teste de agentes IA. Inclui: ChatLab (Next.js), 17 tools de exemplo (Python/FastAPI), test scenarios automatizados, tool marketplace, cost tracking.",
        "resource_type": "template",
        "download_url": "#",  # Diego vai adicionar o link real
        "tier": "pro",
    },
    {
        "title": "Remotion Pipeline (Video com Codigo)",
        "description": "Template de producao de video com Remotion (React). Inclui: componentes (overlays, chapters, end screen), render farm setup (Contabo SSH), pipeline ffmpeg+Groq, teleprompter HTML.",
        "resource_type": "template",
        "download_url": "#",
        "tier": "pro",
    },
    {
        "title": "Stack Claude Code (Harness)",
        "description": "Configuracao completa do Claude Code como CTO Virtual. Inclui: CLAUDE.md, skills, hooks, orchestrator.mjs, memory system, AutoResearch cycle.",
        "resource_type": "playbook",
        "download_url": "#",
        "tier": "pro",
    },
    {
        "title": "Teleprompter PRO",
        "description": "Teleprompter HTML com cues de producao, marcadores de tom, pausas, velocidade ajustavel. Pronto pra usar com qualquer roteiro JSON.",
        "resource_type": "tool",
        "download_url": "#",
        "tier": "pro",
    },
]


async def main():
    engine = create_async_engine(DB_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Seed posts
        for post in POSTS:
            post_id = str(uuid.uuid4())
            await session.execute(
                text("""
                    INSERT INTO community_posts (id, author_name, author_role, content_md, post_type, pinned, created_at)
                    VALUES (:id, :author_name, :author_role, :content_md, :post_type, :pinned, :created_at)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": post_id,
                    "author_name": post["author_name"],
                    "author_role": post["author_role"],
                    "content_md": post["content_md"],
                    "post_type": post["post_type"],
                    "pinned": post["pinned"],
                    "created_at": datetime.now(timezone.utc),
                },
            )
            print(f"Post: {post['post_type']} - {post['content_md'][:50]}...")

        # Seed resources
        for res in RESOURCES:
            res_id = str(uuid.uuid4())
            await session.execute(
                text("""
                    INSERT INTO community_resources (id, title, description, resource_type, download_url, tier, created_at)
                    VALUES (:id, :title, :description, :resource_type, :download_url, :tier, :created_at)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": res_id,
                    "title": res["title"],
                    "description": res["description"],
                    "resource_type": res["resource_type"],
                    "download_url": res["download_url"],
                    "tier": res["tier"],
                    "created_at": datetime.now(timezone.utc),
                },
            )
            print(f"Resource: {res['resource_type']} - {res['title']}")

        await session.commit()
        print("\nSeed completo!")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
