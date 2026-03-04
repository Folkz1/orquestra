"""
Orquestra - YouTube Analysis Service
Trend analysis and content brief generation for GuyFolkz channel.
Uses LLM to analyze trends and generate actionable content ideas.
"""

import logging

from app.config import settings
from app.services.llm import chat_completion, _parse_json_response

logger = logging.getLogger(__name__)

# GuyFolkz channel context
CHANNEL_CONTEXT = """
Canal: GuyFolkz
Nicho: IA (Inteligencia Artificial), Automacao de processos, Bots e Agentes de IA para negocios
Publico: Empreendedores brasileiros, profissionais de TI, devs, entusiastas de IA, criadores de conteudo
Tom: Direto, pratico, sem enrolacao. Foco em resultados e aplicacoes reais.
Dono: Diego - especialista em automacao B2B (R$4-15k + recorrencia)
Meta: Motor 100K (R$100k/mes)
Fontes preferidas: X/Twitter (@OpenAI, @anthropic, @xaborai, trending AI), Reddit (r/artificial, r/ChatGPT, r/automation, r/LocalLLaMA, r/singularity), YouTube trends, noticias tech BR/US
Interseccao: IA + negocios + automacao + agentes autonomos
"""

TREND_ANALYSIS_PROMPT = """Voce e um trend analyst especializado em YouTube brasileiro.
Sua missao: identificar tendencias e gerar ideias de conteudo para o canal GuyFolkz.

{channel_context}

TOPICOS SOLICITADOS: {topics}
FONTES PARA CONSIDERAR: {sources}

Analise as tendencias atuais nesses topicos e gere um JSON com a seguinte estrutura:
{{
    "trends": [
        {{
            "topic": "nome do trend",
            "source": "reddit|youtube|news",
            "heat_level": "hot|warm|emerging",
            "description": "breve descricao da tendencia"
        }}
    ],
    "video_ideas": [
        {{
            "title": "Titulo provocativo (9-15% CTR target)",
            "title_alternatives": ["titulo 2", "titulo 3"],
            "hook": "Frase de abertura nos primeiros 5 segundos",
            "thumbnail_prompt": "Prompt detalhado para gerar thumbnail: alto contraste, texto bold, rosto do apresentador, expressao de surpresa/curiosidade",
            "script_outline": [
                "Intro: gancho + contexto (30s)",
                "Problema: dor do publico (60s)",
                "Solucao: demonstracao pratica (3min)",
                "Resultado: prova social/dados (60s)",
                "CTA: WhatsApp + proximos passos (30s)"
            ],
            "target_audience": "descricao do publico-alvo especifico",
            "seo_keywords": ["keyword1", "keyword2", "keyword3"],
            "estimated_views": "range estimado de views",
            "cta_strategy": "Estrategia de CTA para captura via WhatsApp",
            "difficulty": "easy|medium|hard",
            "urgency": "high|medium|low"
        }}
    ],
    "market_insights": [
        "insight 1 sobre o mercado atual",
        "insight 2 sobre oportunidades"
    ]
}}

REGRAS:
1. Titulos PROVOCATIVOS que geram cliques (padrao 9-15% CTR)
2. Thumbnails: alto contraste, texto bold grande, rosto com expressao, fundo solido ou gradiente
3. CTA sempre direciona para WhatsApp (captura de leads)
4. Foco na interseccao IA + negocios + automacao + agentes autonomos
5. Considere X/Twitter e Reddit como fontes primarias de tendencias
6. Gere exatamente 3-5 ideias de video
7. Responda APENAS com o JSON.
"""

CONTENT_BRIEF_PROMPT = """Voce e um roteirista de YouTube para o canal GuyFolkz.
Gere um briefing COMPLETO para um video sobre o topico abaixo.

{channel_context}

TOPICO: {topic}
CONTEXTO ADICIONAL: {context}

Retorne um JSON com a estrutura:
{{
    "title_options": [
        "Opcao 1 - provocativa",
        "Opcao 2 - curiosidade",
        "Opcao 3 - urgencia",
        "Opcao 4 - beneficio direto",
        "Opcao 5 - controversia"
    ],
    "thumbnail_prompts": [
        "Prompt 1: [detalhes visuais, cores, texto overlay, expressao facial]",
        "Prompt 2: [variacao alternativa]"
    ],
    "script_outline": {{
        "hook": "Primeiros 5 segundos - frase de impacto",
        "intro": "Contexto e promessa do video (30-60s)",
        "sections": [
            {{
                "title": "Nome da secao",
                "duration": "tempo estimado",
                "content": "O que cobrir nesta secao",
                "visual_cue": "Sugestao visual/B-roll"
            }}
        ],
        "cta_mid": "CTA no meio do video",
        "conclusion": "Resumo + proximos passos",
        "cta_final": "CTA final para WhatsApp"
    }},
    "target_audience": "Descricao detalhada do publico-alvo",
    "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
    "estimated_performance": {{
        "views_range": "min-max estimado",
        "ctr_target": "9-15%",
        "avg_watch_time_target": "minutos",
        "engagement_strategy": "descricao"
    }},
    "references": ["links ou fontes para pesquisa"]
}}

Responda APENAS com o JSON.
"""


async def analyze_channel_trends(
    topics: list[str] | None = None,
    sources: list[str] | None = None,
) -> dict:
    """
    Use LLM to analyze YouTube trends and generate content ideas.

    Args:
        topics: List of topics to analyze (default: AI, automacao, licitacoes).
        sources: List of sources to consider (default: reddit, youtube, news).

    Returns:
        Dict with trends, video_ideas, and market_insights.
    """
    if not topics:
        topics = ["IA", "automacao", "ChatGPT", "agentes de IA", "Claude", "MCP"]
    if not sources:
        sources = ["twitter/x", "reddit", "youtube", "news"]

    prompt = TREND_ANALYSIS_PROMPT.format(
        channel_context=CHANNEL_CONTEXT,
        topics=", ".join(topics),
        sources=", ".join(sources),
    )

    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Analise tendencias atuais para os topicos: {', '.join(topics)}. "
                f"Fontes: {', '.join(sources)}. "
                "Gere 3-5 ideias de video com titulos provocativos e thumbnails detalhadas. "
                "Foco em conteudo que gera leads via WhatsApp."
            ),
        },
    ]

    response = await chat_completion(
        messages,
        model=settings.MODEL_CHAT_SMART,
        temperature=0.7,
        max_tokens=6000,
    )

    result = _parse_json_response(response)
    logger.info(
        "[YOUTUBE] Trend analysis complete: %d ideas generated",
        len(result.get("video_ideas", [])),
    )
    return result


async def generate_content_brief(
    topic: str,
    channel_context: str = "",
) -> dict:
    """
    Generate a complete content brief for a YouTube video.

    Args:
        topic: The video topic.
        channel_context: Additional context (e.g., from memory search).

    Returns:
        Dict with title_options, thumbnail_prompts, script_outline, etc.
    """
    prompt = CONTENT_BRIEF_PROMPT.format(
        channel_context=CHANNEL_CONTEXT,
        topic=topic,
        context=channel_context or "Nenhum contexto adicional.",
    )

    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Gere um briefing completo para um video sobre: {topic}\n"
                "Inclua 5 opcoes de titulo, prompts de thumbnail, roteiro detalhado, "
                "e estrategia de CTA para WhatsApp."
            ),
        },
    ]

    response = await chat_completion(
        messages,
        model=settings.MODEL_CHAT_SMART,
        temperature=0.6,
        max_tokens=6000,
    )

    result = _parse_json_response(response)
    logger.info("[YOUTUBE] Content brief generated for topic: %s", topic)
    return result
