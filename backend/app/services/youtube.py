"""
Orquestra - YouTube analysis and editorial strategy service.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models import MemoryEmbedding
from app.services.llm import _parse_json_response, chat_completion
from app.services.youtube_data import (
    get_channel_stats,
    get_or_create_project_by_name,
    get_project_access_token,
    list_channel_videos,
)

logger = logging.getLogger(__name__)


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

DEFAULT_YOUTUBE_STRATEGY: dict[str, Any] = {
    "version": 2,
    "goal": "Motor 100K",
    "positioning": "IA aplicada a operacao, automacao B2B e sistemas reais",
    "north_star": "YouTube como topo de funil para gerar leads B2B no WhatsApp",
    "big_idea": "Eu nao virei mais um cara de IA. Eu virei um operador de sistemas atraves de IA.",
    "brand_narrative": "Diego mostra como usar IA, n8n, agentes e automacao para operar melhor, vender mais e construir sistemas reais.",
    "editorial_formula": "busca para atrair, prova para convencer, oferta para monetizar",
    "style": {
        "tone": "direto, tecnico, pratico, energetico e conversado",
        "visual": "premium, escuro, contraste alto, moderno, sem poluicao",
        "editing": "ritmo forte no hook, clareza tecnica no miolo, prova visual sempre que houver promessa",
        "pacing": "denso nos primeiros 20s, objetivo no miolo tecnico, fechamento simples e claro",
    },
    "publishing_rhythm": {
        "weekly_long_videos": 2,
        "weekly_shorts": 7,
        "weekly_lives": 0,
        "calendar": [
            {
                "series": "A Virada",
                "slot": "terca 12:00",
                "format": "longo",
                "goal": "autoridade + bastidor + prova",
            },
            {
                "series": "RADAR IA",
                "slot": "sexta 12:00",
                "format": "longo",
                "goal": "descoberta + recorrencia + repertorio",
            },
        ],
    },
    "content_pillars": [
        "Automacao comercial",
        "n8n e infra em producao",
        "IA aplicada a licitacoes",
        "Agentes para operacao real",
        "Negocio de automacao",
    ],
    "preferred_title_patterns": [
        "o jeito certo de...",
        "como eu faria...",
        "o erro que...",
        "esse sistema...",
        "quanto custa ... e quanto devolve",
        "pare de ... faca isso",
    ],
    "cta_templates": {
        "cold": "Se voce quer construir automacoes reais, se inscreve e acompanha os proximos testes.",
        "warm": "Se voce quer esse fluxo adaptado para o seu caso, o link esta na descricao.",
        "hot": "Se voce quer que eu desenhe essa operacao com voce, me chama no WhatsApp.",
    },
    "source_materials": [],
    "series": [
        {
            "slug": "a-virada",
            "name": "A Virada",
            "status": "ativa",
            "objective": "Transformar a historia do Diego em autoridade operacional e prova de metodo.",
            "content_role": "meio/fundo de funil",
            "cadence": "1 episodio por semana",
            "format": "video longo 10-20min",
            "thumbnail_rule": "resultado + tensao + sistema real",
            "summary": "Serie de bastidores e virada operacional: menos execucao manual, mais sistema, mais margem.",
            "idea_seeds": [
                "Como o Claude Code me fez trabalhar menos e entregar mais",
                "Como eu parei de mexer em tudo e meu negocio cresceu",
                "Meu novo fluxo: eu falo, a IA executa",
                "De R$110/mes para R$18k: a conta que ninguem faz",
            ],
            "episodes": [
                {
                    "code": "AV-01",
                    "title": "Como o Claude Code Me Fez Trabalhar MENOS e Entregar MAIS",
                    "status": "planejado",
                },
                {
                    "code": "AV-02",
                    "title": "Como Eu PAREI de Mexer em TUDO (E Meu Negocio CRESCEU)",
                    "status": "planejado",
                },
                {
                    "code": "AV-03",
                    "title": "Meu Novo Fluxo: EU FALO, a IA EXECUTA",
                    "status": "planejado",
                },
                {
                    "code": "AV-04",
                    "title": "O Papel do Claude Code Dentro do Meu ECOSSISTEMA",
                    "status": "planejado",
                },
                {
                    "code": "AV-05",
                    "title": "Onde o Claude Code AINDA Falha (E Precisa de Mim)",
                    "status": "planejado",
                },
                {
                    "code": "AV-06",
                    "title": "De R$110/mes para R$18K: A Conta que Ninguem Faz",
                    "status": "planejado",
                },
            ],
        },
        {
            "slug": "radar-ia",
            "name": "RADAR IA",
            "status": "ativa",
            "objective": "Criar habito semanal e puxar publico frio com noticias filtradas pelo impacto pratico.",
            "content_role": "topo/meio de funil",
            "cadence": "1 episodio por semana",
            "format": "video longo 8-12min",
            "thumbnail_rule": "uma manchete dominante + take forte do Diego",
            "summary": "Curadoria semanal: o que importa em IA e como isso afeta negocio, automacao e servico.",
            "idea_seeds": [
                "RADAR IA: o que muda para automacao B2B nessa semana",
                "RADAR IA: as 3 noticias que realmente importam para quem vende automacao",
                "RADAR IA: o que e hype e o que vira projeto pago",
                "RADAR IA: ferramentas que mexem com n8n, agentes e operacao",
            ],
            "episodes": [
                {
                    "code": "RI-01",
                    "title": "RADAR IA #01",
                    "status": "rascunho",
                },
                {
                    "code": "RI-02",
                    "title": "RADAR IA #02",
                    "status": "planejado",
                },
                {
                    "code": "RI-03",
                    "title": "RADAR IA #03",
                    "status": "planejado",
                },
                {
                    "code": "RI-04",
                    "title": "RADAR IA #04",
                    "status": "planejado",
                },
            ],
        },
    ],
}

TREND_ANALYSIS_PROMPT = """Voce e um trend analyst especializado em YouTube brasileiro.
Sua missao: identificar tendencias e gerar ideias de conteudo para o canal GuyFolkz.

{channel_context}

ESTRATEGIA EDITORIAL FIXA:
{strategy_context}

SNAPSHOT DO CANAL:
{channel_snapshot}

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
            "thumbnail_prompt": "Prompt detalhado para gerar thumbnail",
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
            "urgency": "high|medium|low",
            "recommended_series": "A Virada|RADAR IA|Fora de serie",
            "content_goal": "topo|meio|fundo",
            "why_now": "por que isso importa agora",
            "fit_score": 0
        }}
    ],
    "market_insights": [
        "insight 1 sobre o mercado atual",
        "insight 2 sobre oportunidades"
    ]
}}

REGRAS:
1. Respeite as duas series fixas: A Virada e RADAR IA.
2. Titulos precisam combinar clique com aplicacao real.
3. RADAR IA nunca pode virar noticia generica: sempre terminar em impacto pratico.
4. A Virada precisa soar como bastidor, sistema, prova e virada operacional.
5. CTA sempre direciona para WhatsApp (captura de leads).
6. Gere exatamente 4 ideias de video.
7. Responda APENAS com JSON.
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


def get_default_youtube_strategy() -> dict[str, Any]:
    return deepcopy(DEFAULT_YOUTUBE_STRATEGY)


def _merge_dict(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _median(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle]


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _title_views_average(videos: list[dict[str, Any]], keywords: tuple[str, ...]) -> int:
    matched_views = [
        int(video.get("views") or 0)
        for video in videos
        if any(keyword in _normalize_text(video.get("title")) for keyword in keywords)
        and int(video.get("views") or 0) > 0
    ]
    if not matched_views:
        return 0
    return sum(matched_views) // len(matched_views)


def _series_name_for_idea(video: dict[str, Any]) -> str:
    explicit = _normalize_text(video.get("recommended_series"))
    if explicit in {"a virada", "radar ia"}:
        return "A Virada" if explicit == "a virada" else "RADAR IA"

    text = " ".join(
        [
            video.get("title") or "",
            video.get("hook") or "",
            video.get("formato") or "",
        ]
    ).lower()

    radar_keywords = (
        "radar",
        "semana",
        "openai",
        "anthropic",
        "gpt",
        "gemini",
        "qwen",
        "netflix",
        "google",
        "lancou",
        "lançou",
        "noticia",
        "news",
    )
    if any(keyword in text for keyword in radar_keywords):
        return "RADAR IA"

    virada_keywords = (
        "claude code",
        "me fez",
        "parei",
        "meu fluxo",
        "ecossistema",
        "trabalhar menos",
        "entregar mais",
        "bastidor",
        "operar",
        "sistema",
    )
    if any(keyword in text for keyword in virada_keywords):
        return "A Virada"

    return "A Virada"


def _build_channel_stage(subscribers: int) -> str:
    if subscribers >= 100_000:
        return "100k+"
    if subscribers >= 50_000:
        return "50k-100k"
    if subscribers >= 10_000:
        return "10k-50k"
    if subscribers >= 1_000:
        return "1k-10k"
    return "0-1k"


def _fallback_series_lanes(strategy: dict[str, Any]) -> list[dict[str, Any]]:
    lanes: list[dict[str, Any]] = []
    for series in strategy.get("series", []):
        lanes.append(
            {
                "series": series.get("name"),
                "objective": series.get("objective"),
                "ideas": [
                    {
                        "title": title,
                        "recommended_series": series.get("name"),
                        "urgency": "medium",
                        "status": "seed",
                    }
                    for title in series.get("idea_seeds", [])[:4]
                ],
            }
        )
    return lanes


def _extract_pipeline_summary(briefing: dict[str, Any] | None) -> dict[str, Any]:
    videos = list((briefing or {}).get("videos", []) or [])
    by_status = {
        "ideia": 0,
        "thumbnail_pronta": 0,
        "pronto_gravar": 0,
        "publicado": 0,
    }
    for video in videos:
        status = video.get("status") or "ideia"
        by_status[status] = by_status.get(status, 0) + 1

    return {
        "videos_total": len(videos),
        "by_status": by_status,
        "ready_to_record": by_status.get("pronto_gravar", 0),
        "thumb_ready": by_status.get("thumbnail_pronta", 0),
    }


def _build_playbook_snapshot(strategy: dict[str, Any]) -> dict[str, Any]:
    source_materials = list(strategy.get("source_materials", []) or [])
    speaking_style = dict(strategy.get("speaking_style") or {})
    voice_core = dict(speaking_style.get("voice_core") or {})
    signature_elements = dict(speaking_style.get("signature_elements") or {})
    return {
        "big_idea": strategy.get("big_idea") or "",
        "brand_narrative": strategy.get("brand_narrative") or "",
        "editorial_formula": strategy.get("editorial_formula") or "",
        "content_pillars": list(strategy.get("content_pillars", []) or [])[:6],
        "title_patterns": list(strategy.get("preferred_title_patterns", []) or [])[:6],
        "cta_templates": dict(strategy.get("cta_templates") or {}),
        "style": dict(strategy.get("style") or {}),
        "voice_promise_style": voice_core.get("promise_style") or "",
        "signature_phrases": list(signature_elements.get("high_frequency", []) or [])[:6],
        "source_materials": source_materials,
        "source_count": len(source_materials),
        "last_synced_at": strategy.get("last_synced_at") or "",
    }


async def get_project_youtube_strategy(
    db: AsyncSession,
    project_name: str = "GuyFolkz",
    *,
    persist_default: bool = False,
) -> dict[str, Any]:
    project = await get_or_create_project_by_name(db, project_name)
    current_credentials = dict(project.credentials or {})
    stored_strategy = current_credentials.get("youtube_strategy")
    strategy = _merge_dict(get_default_youtube_strategy(), stored_strategy or {})

    if persist_default and not stored_strategy:
        current_credentials["youtube_strategy"] = strategy
        project.credentials = current_credentials
        flag_modified(project, "credentials")
        await db.flush()
        await db.refresh(project)

    return strategy


async def save_project_youtube_strategy(
    db: AsyncSession,
    project_name: str,
    strategy_payload: dict[str, Any],
) -> dict[str, Any]:
    project = await get_or_create_project_by_name(db, project_name)
    current_credentials = dict(project.credentials or {})
    strategy = _merge_dict(get_default_youtube_strategy(), strategy_payload or {})
    current_credentials["youtube_strategy"] = strategy
    project.credentials = current_credentials
    flag_modified(project, "credentials")
    await db.flush()
    await db.refresh(project)
    return strategy


async def _get_latest_memory_payload(
    db: AsyncSession,
    source_type: str,
    key: str,
    project_name: str = "GuyFolkz",
) -> dict[str, Any] | None:
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == source_type)
        .where(MemoryEmbedding.project_name == project_name)
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        return None
    return dict((row.metadata_ or {}).get(key) or {})


async def build_youtube_workspace(
    db: AsyncSession,
    project_name: str = "GuyFolkz",
) -> dict[str, Any]:
    strategy = await get_project_youtube_strategy(db, project_name, persist_default=False)
    latest_briefing = await _get_latest_memory_payload(db, "youtube_briefing", "briefing", project_name) or {}
    latest_analytics = await _get_latest_memory_payload(db, "youtube_analytics", "analytics", project_name) or {}

    channel_error = ""
    current_stats: dict[str, Any] = {}
    current_videos: list[dict[str, Any]] = []

    try:
        access_token, youtube_credentials = await get_project_access_token(db, project_name)
        channel_id = youtube_credentials.get("channel_id", "")
        current_stats = await get_channel_stats(access_token, channel_id)
        current_videos = await list_channel_videos(access_token, channel_id, max_results=30)
    except Exception as exc:  # pragma: no cover - fallback path is expected locally
        channel_error = str(exc)
        logger.warning("[YOUTUBE] Workspace fallback for %s: %s", project_name, channel_error)

    public_videos = [video for video in current_videos if video.get("privacy_status") == "public"]
    video_pool = public_videos or current_videos or list(latest_analytics.get("videos", []))
    view_counts = [int(video.get("views") or 0) for video in video_pool if int(video.get("views") or 0) > 0]
    recent_views = [int(video.get("views") or 0) for video in video_pool[:5] if int(video.get("views") or 0) > 0]

    subscribers = int(current_stats.get("subscribers") or latest_analytics.get("subscribers") or 0)
    avg_views = sum(view_counts) // len(view_counts) if view_counts else int(latest_analytics.get("avg_views") or 0)
    median_views = _median(view_counts) if view_counts else int(latest_analytics.get("median_views") or 0)
    recent_avg_views = sum(recent_views) // len(recent_views) if recent_views else avg_views
    best_video = max(video_pool, key=lambda item: int(item.get("views") or 0), default={})

    practical_avg = _title_views_average(
        video_pool,
        ("como", "guia", "erro", "n8n", "whatsapp", "ocr", "api", "sistema", "instalar", "modo fila"),
    )
    business_avg = _title_views_average(
        video_pool,
        ("lead", "vendas", "crm", "licit", "resultado", "r$", "milh", "cliente"),
    )
    macro_news_avg = _title_views_average(
        video_pool,
        ("openai", "claude", "gpt", "gemini", "qwen", "nvidia", "governo", "ia ", "ia:", "ia?"),
    )
    operator_avg = _title_views_average(
        video_pool,
        ("eu", "meu", "parei", "ecossistema", "claude code", "fluxo", "trabalhar menos"),
    )

    top_patterns: list[str] = []
    if practical_avg and practical_avg >= max(macro_news_avg, business_avg):
        top_patterns.append("Videos de metodo, erro e tutorial pratico estao acima da media do canal.")
    if business_avg and business_avg >= median_views:
        top_patterns.append("Promessas com dinheiro, sistema e impacto comercial puxam cliques mais fortes.")
    if operator_avg and operator_avg >= median_views:
        top_patterns.append("Narrativa pessoal de operador/sistema tem espaco para virar serie de autoridade.")
    if not top_patterns:
        top_patterns.append("O canal responde melhor quando IA aparece conectada a processo real e resultado.")

    existing_titles = [(_normalize_text(video.get("title"))) for video in video_pool]
    opportunity_gaps: list[str] = []
    if not any("radar ia" in title for title in existing_titles):
        opportunity_gaps.append("RADAR IA ainda nao virou ritual semanal. Isso abre espaco para recorrencia com discovery.")
    if not any("a virada" in title for title in existing_titles):
        opportunity_gaps.append("A Virada ainda nao esta marcada como narrativa recorrente do canal.")
    if practical_avg > macro_news_avg:
        opportunity_gaps.append("Noticias puras tendem a performar pior que videos com metodo. RADAR IA precisa terminar em impacto pratico.")
    if recent_avg_views and median_views and recent_avg_views < median_views:
        opportunity_gaps.append("Os ultimos videos estao abaixo da mediana historica. Falta reforcar thumbnail e promessa logo no titulo.")
    if not opportunity_gaps:
        opportunity_gaps.append("Oportunidade principal: serializar o que ja funcionou em vez de publicar temas isolados.")

    pipeline = _extract_pipeline_summary(latest_briefing)
    videos_from_briefing = list((latest_briefing or {}).get("videos", []) or [])
    lanes_map: dict[str, dict[str, Any]] = {}
    for series in strategy.get("series", []):
        lanes_map[series.get("name")] = {
            "series": series.get("name"),
            "objective": series.get("objective"),
            "ideas": [],
        }

    for video in videos_from_briefing:
        series_name = _series_name_for_idea(video)
        lanes_map.setdefault(
            series_name,
            {"series": series_name, "objective": "", "ideas": []},
        )["ideas"].append(
            {
                "title": video.get("chosen_title") or video.get("title"),
                "status": video.get("status") or "ideia",
                "urgency": video.get("urgencia") or video.get("urgency") or "media",
                "hook": video.get("hook") or "",
                "recommended_series": series_name,
            }
        )

    series_lanes = [lane for lane in lanes_map.values() if lane.get("ideas")]
    if not series_lanes:
        series_lanes = _fallback_series_lanes(strategy)

    series_health = []
    for series in strategy.get("series", []):
        episodes = list(series.get("episodes", []) or [])
        next_episode = next((episode for episode in episodes if episode.get("status") != "publicado"), None)
        ideas_in_lane = next((lane for lane in series_lanes if lane.get("series") == series.get("name")), None)
        series_health.append(
            {
                "name": series.get("name"),
                "objective": series.get("objective"),
                "cadence": series.get("cadence"),
                "content_role": series.get("content_role"),
                "summary": series.get("summary"),
                "episodes_total": len(episodes),
                "episodes_planned": len([episode for episode in episodes if episode.get("status") != "publicado"]),
                "ideas_in_pipeline": len((ideas_in_lane or {}).get("ideas", [])),
                "next_episode": next_episode,
            }
        )

    next_actions: list[str] = [
        "Fixar o calendario editorial: A Virada na terca 12h e RADAR IA na sexta 12h.",
        "Toda pauta nova precisa nascer ja com serie definida. Sem video solto fora das duas trilhas principais.",
    ]
    if pipeline.get("thumb_ready", 0) == 0:
        next_actions.append("Escolher pelo menos 1 video do pipeline e fechar thumbnail hoje.")
    if pipeline.get("ready_to_record", 0) == 0 and videos_from_briefing:
        next_actions.append("Subir 1 pauta para pronto_gravar antes de gerar novas ideias.")
    if videos_from_briefing:
        next_actions.append(f"Priorizar '{videos_from_briefing[0].get('title', 'proxima pauta')}' no proximo ciclo.")
    next_actions.append("No RADAR IA, fechar sempre com a pergunta: isso vira projeto, servico ou nao?")

    channel_audit = {
        "stage": _build_channel_stage(subscribers),
        "subscribers": subscribers,
        "total_views": int(current_stats.get("total_views") or latest_analytics.get("total_views") or 0),
        "total_videos": int(current_stats.get("total_videos") or latest_analytics.get("videos_count") or len(video_pool)),
        "avg_views": avg_views,
        "median_views": median_views,
        "recent_avg_views": recent_avg_views,
        "best_video": {
            "title": best_video.get("title") or "",
            "views": int(best_video.get("views") or 0),
            "url": best_video.get("url") or "",
        },
        "pattern_scores": {
            "practical_avg": practical_avg,
            "business_avg": business_avg,
            "macro_news_avg": macro_news_avg,
            "operator_avg": operator_avg,
        },
        "top_patterns": top_patterns,
        "opportunity_gaps": opportunity_gaps,
        "source": "youtube_api" if current_videos else "analytics_snapshot",
        "warning": channel_error,
    }

    return {
        "project_name": project_name,
        "strategy": strategy,
        "playbook": _build_playbook_snapshot(strategy),
        "channel_audit": channel_audit,
        "pipeline": pipeline,
        "series_health": series_health,
        "series_lanes": series_lanes,
        "next_actions": next_actions,
        "latest_briefing": latest_briefing,
    }


def _strategy_context_text(strategy_context: dict[str, Any] | None) -> str:
    if not strategy_context:
        return "Sem estrategia adicional."
    lines = [
        f"- Objetivo: {strategy_context.get('goal', 'Motor 100K')}",
        f"- Posicionamento: {strategy_context.get('positioning', '')}",
    ]
    for series in strategy_context.get("series", []):
        lines.append(
            f"- Serie {series.get('name')}: {series.get('summary')} | Cadencia: {series.get('cadence')}"
        )
    return "\n".join(lines)


def _channel_snapshot_text(channel_snapshot: dict[str, Any] | None) -> str:
    if not channel_snapshot:
        return "Sem snapshot de canal."
    best_video = channel_snapshot.get("best_video") or {}
    top_patterns = channel_snapshot.get("top_patterns") or []
    return (
        f"- Inscritos: {channel_snapshot.get('subscribers', 0)}\n"
        f"- Media de views: {channel_snapshot.get('avg_views', 0)}\n"
        f"- Mediana de views: {channel_snapshot.get('median_views', 0)}\n"
        f"- Melhor video: {best_video.get('title', '')} ({best_video.get('views', 0)} views)\n"
        f"- Padrões fortes: {' | '.join(top_patterns[:3]) or 'sem dados'}"
    )


async def analyze_channel_trends(
    topics: list[str] | None = None,
    sources: list[str] | None = None,
    *,
    strategy_context: dict[str, Any] | None = None,
    channel_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not topics:
        topics = ["IA", "automacao", "ChatGPT", "agentes de IA", "Claude", "MCP"]
    if not sources:
        sources = ["twitter/x", "reddit", "youtube", "news"]

    prompt = TREND_ANALYSIS_PROMPT.format(
        channel_context=CHANNEL_CONTEXT,
        strategy_context=_strategy_context_text(strategy_context),
        channel_snapshot=_channel_snapshot_text(channel_snapshot),
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
                "Gere ideias de video alinhadas as series A Virada e RADAR IA. "
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
) -> dict[str, Any]:
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
