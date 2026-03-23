"""
Orquestra - YouTube analysis and editorial strategy service.
"""

from __future__ import annotations

import logging
import re
import unicodedata
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
    "version": 3,
    "goal": "Motor 100K",
    "positioning": "IA aplicada a operacao, automacao B2B, produto e sistemas reais",
    "north_star": "YouTube como topo de funil para gerar leads B2B e autoridade tecnica no WhatsApp",
    "big_idea": "Eu nao virei mais um cara de IA. Eu virei um operador de sistemas com IA e codigo aplicados ao negocio.",
    "brand_narrative": "Diego mostra como usar IA, n8n, agentes, React e automacao para operar melhor, vender mais e construir sistemas reais.",
    "editorial_formula": "busca para atrair, prova para convencer, oferta para monetizar",
    "operating_rules": [
        "Toda pauta precisa nascer com serie, promessa e CTA definidos.",
        "RADAR IA fecha sempre em impacto pratico: projeto, servico ou acao concreta.",
        "A Virada precisa mostrar sistema, bastidor, prova e decisao operacional real.",
        "React na Pratica precisa partir de bug, interface, performance ou arquitetura real.",
        "Nada de video solto: cada publicacao precisa reforcar uma trilha editorial clara.",
    ],
    "style": {
        "tone": "direto, tecnico, pratico, energetico e conversado",
        "visual": "premium, escuro, contraste alto, moderno, sem poluicao",
        "editing": "ritmo forte no hook, clareza tecnica no miolo, prova visual sempre que houver promessa",
        "pacing": "denso nos primeiros 20s, objetivo no miolo tecnico, fechamento simples e claro",
    },
    "publishing_rhythm": {
        "weekly_long_videos": 3,
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
                "series": "React na Pratica",
                "slot": "quarta 12:00",
                "format": "longo",
                "goal": "busca evergreen + autoridade tecnica + dev funnel",
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
        "React e Next.js para produto real",
    ],
    "preferred_title_patterns": [
        "o jeito certo de...",
        "como eu faria...",
        "o erro que...",
        "esse sistema...",
        "quanto custa ... e quanto devolve",
        "pare de ... faca isso",
        "3 erros que quebram ...",
    ],
    "cta_templates": {
        "cold": "Se voce quer construir automacoes e sistemas reais, se inscreve e acompanha os proximos testes.",
        "warm": "Se voce quer esse fluxo adaptado para o seu caso, o link esta na descricao.",
        "hot": "Se voce quer que eu desenhe essa operacao com voce, me chama no WhatsApp.",
    },
    "recording_focus": {
        "series": "",
        "title": "",
        "status": "",
        "source": "",
        "reason": "",
        "updated_at": "",
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
            "audience": "Empreendedor, operador e dev que quer aplicar IA em processos reais.",
            "promise": "Mostrar a virada operacional com prova, stack e impacto financeiro.",
            "cta_focus": "Mentoria, implantacao ou desenho de automacao via WhatsApp.",
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
            "slug": "react-na-pratica",
            "name": "React na Pratica",
            "status": "ativa",
            "objective": "Abrir frente semanal de busca evergreen com React e Next.js ligados a produto real.",
            "content_role": "topo/meio de funil",
            "cadence": "1 episodio por semana",
            "format": "video longo 8-15min",
            "thumbnail_rule": "bug ou UI clara + before/after + uma promessa objetiva",
            "summary": "Serie semanal de React aplicada a produto: bugs reais, arquitetura, UI e decisao tecnica sem tutorial generico.",
            "audience": "Devs, founders e times de produto que constroem app real com React ou Next.js.",
            "promise": "Resolver uma dor concreta de interface, estado, arquitetura ou performance em cada episodio.",
            "cta_focus": "Projetos com stack web, automacao de produto ou consultoria tecnica.",
            "idea_seeds": [
                "O jeito certo de usar useEffect em 2026",
                "3 erros de estado que quebram teu app React",
                "Como eu organizo componentes React sem virar bagunca",
                "Next.js ou React puro: como eu escolho em projeto real",
            ],
            "episodes": [
                {
                    "code": "RP-01",
                    "title": "O Jeito Certo de Usar useEffect em 2026",
                    "status": "planejado",
                },
                {
                    "code": "RP-02",
                    "title": "3 Erros de Estado que QUEBRAM teu App React",
                    "status": "planejado",
                },
                {
                    "code": "RP-03",
                    "title": "Como Eu Organizo Componentes React sem Virar Bagunca",
                    "status": "planejado",
                },
                {
                    "code": "RP-04",
                    "title": "Next.js ou React Puro: Como Eu Escolho em Projeto Real",
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
            "audience": "Publico frio que acompanha novidades de IA, automacao e ferramentas.",
            "promise": "Filtrar hype e transformar noticia em oportunidade pratica de negocio.",
            "cta_focus": "Discovery, diagnostico e implantacao de automacao.",
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

ESTRATEGIA EDITORIAL ATIVA:
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
            "recommended_series": "nome exato da serie mais adequada",
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
1. Escolha sempre a serie mais adequada dentre as series ativas descritas na estrategia.
2. Titulos precisam combinar clique com aplicacao real.
3. Series de noticia ou discovery nunca podem virar noticia generica: sempre terminar em impacto pratico.
4. Series de bastidor e prova precisam soar como sistema, metodo, prova e virada operacional.
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


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _unique_preserve_order(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    seen: set[str] = set()
    for value in values:
        clean_value = _clean_text(value)
        marker = _normalize_text(clean_value)
        if not marker or marker in seen:
            continue
        seen.add(marker)
        unique.append(clean_value)
    return unique


def _named_item_key(item: dict[str, Any], key: str) -> str:
    raw_value = item.get(key) or item.get("name") or item.get("series")
    return _normalize_text(str(raw_value))


def _slugify(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", _clean_text(value))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def _compact_episode(item: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    episode = deepcopy(item)
    for key, value in list(episode.items()):
        if isinstance(value, str):
            episode[key] = value.strip()
    if not episode.get("title") and not episode.get("code"):
        return None
    return episode


def _compact_recording_focus(item: dict[str, Any] | None) -> dict[str, Any]:
    focus = dict(item or {})
    return {
        "series": _clean_text(focus.get("series")),
        "title": _clean_text(focus.get("title")),
        "status": _clean_text(focus.get("status")),
        "source": _clean_text(focus.get("source")),
        "reason": _clean_text(focus.get("reason")),
        "updated_at": _clean_text(focus.get("updated_at")),
    }


def _compact_calendar_items(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in list(items or []):
        if not isinstance(item, dict):
            continue
        calendar_item = {
            "series": _clean_text(item.get("series") or item.get("name")),
            "slot": _clean_text(item.get("slot")),
            "format": _clean_text(item.get("format")),
            "goal": _clean_text(item.get("goal")),
        }
        if not any(calendar_item.values()):
            continue
        if not calendar_item["series"]:
            continue
        cleaned.append({key: value for key, value in calendar_item.items() if value})
    return _merge_named_objects([], cleaned, "series")


def _order_series_by_calendar(
    series_items: list[dict[str, Any]],
    calendar_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not series_items:
        return []

    by_name = {_normalize_text(item.get("name")): item for item in series_items}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()

    for calendar_item in calendar_items:
        series_name = _normalize_text(calendar_item.get("series"))
        if not series_name or series_name not in by_name or series_name in seen:
            continue
        ordered.append(by_name[series_name])
        seen.add(series_name)

    for item in series_items:
        series_name = _normalize_text(item.get("name"))
        if series_name in seen:
            continue
        ordered.append(item)
        seen.add(series_name)

    return ordered


def _compact_series_items(
    items: list[dict[str, Any]] | None,
    calendar_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in list(items or []):
        if not isinstance(item, dict):
            continue
        series = deepcopy(item)
        series["name"] = _clean_text(series.get("name"))
        series["slug"] = _clean_text(series.get("slug")) or _slugify(series.get("name"))
        if not series["name"] and not series["slug"]:
            continue
        if not series["name"]:
            series["name"] = series["slug"].replace("-", " ").title()
        if not series["slug"]:
            series["slug"] = _slugify(series["name"])

        for field in (
            "status",
            "objective",
            "content_role",
            "cadence",
            "format",
            "thumbnail_rule",
            "summary",
            "audience",
            "promise",
            "cta_focus",
        ):
            if field in series or field in {"status", "objective", "summary"}:
                series[field] = _clean_text(series.get(field))

        series["status"] = series.get("status") or "ativa"
        series["idea_seeds"] = _unique_preserve_order(series.get("idea_seeds") or [])
        series["episodes"] = [
            compacted
            for compacted in (_compact_episode(episode) for episode in list(series.get("episodes", []) or []))
            if compacted
        ]
        cleaned.append(series)

    merged = _merge_named_objects([], cleaned, "slug")
    return _order_series_by_calendar(merged, calendar_items)


def _compact_strategy(strategy: dict[str, Any]) -> dict[str, Any]:
    compacted = deepcopy(strategy or {})

    for field in (
        "goal",
        "positioning",
        "north_star",
        "big_idea",
        "brand_narrative",
        "editorial_formula",
        "last_synced_at",
    ):
        if field in compacted:
            compacted[field] = _clean_text(compacted.get(field))

    compacted["content_pillars"] = _unique_preserve_order(compacted.get("content_pillars") or [])
    compacted["preferred_title_patterns"] = _unique_preserve_order(compacted.get("preferred_title_patterns") or [])
    compacted["operating_rules"] = _unique_preserve_order(compacted.get("operating_rules") or [])
    compacted["source_materials"] = _unique_preserve_order(compacted.get("source_materials") or [])

    style = dict(compacted.get("style") or {})
    for key in ("tone", "visual", "editing", "pacing"):
        if key in style:
            style[key] = _clean_text(style.get(key))
    compacted["style"] = style

    cta_templates = dict(compacted.get("cta_templates") or {})
    for key, value in list(cta_templates.items()):
        cta_templates[key] = _clean_text(value)
    compacted["cta_templates"] = cta_templates
    compacted["recording_focus"] = _compact_recording_focus(compacted.get("recording_focus"))

    rhythm = dict(compacted.get("publishing_rhythm") or {})
    for key in ("weekly_long_videos", "weekly_shorts", "weekly_lives"):
        try:
            rhythm[key] = int(rhythm.get(key) or 0)
        except (TypeError, ValueError):
            rhythm[key] = 0
    rhythm["calendar"] = _compact_calendar_items(rhythm.get("calendar") or [])
    compacted["publishing_rhythm"] = rhythm
    compacted["series"] = _compact_series_items(compacted.get("series") or [], rhythm["calendar"])
    return compacted


def _merge_named_objects(
    base_items: list[dict[str, Any]] | None,
    updated_items: list[dict[str, Any]] | None,
    key: str,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for item in list(base_items or []):
        item_key = _named_item_key(item, key)
        if not item_key:
            merged.append(deepcopy(item))
            continue
        by_key[item_key] = deepcopy(item)
        order.append(item_key)

    for item in list(updated_items or []):
        item_key = _named_item_key(item, key)
        if not item_key:
            merged.append(deepcopy(item))
            continue
        if item_key in by_key:
            by_key[item_key] = _merge_dict(by_key[item_key], item)
        else:
            by_key[item_key] = deepcopy(item)
            order.append(item_key)

    merged.extend(by_key[item_key] for item_key in order)
    return merged


def _merge_strategy(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    updates = updates or {}
    merged = _merge_dict(base, updates)

    merged["content_pillars"] = _unique_preserve_order(
        updates.get("content_pillars")
        if isinstance(updates.get("content_pillars"), list)
        else base.get("content_pillars", []) or []
    )
    merged["preferred_title_patterns"] = _unique_preserve_order(
        updates.get("preferred_title_patterns")
        if isinstance(updates.get("preferred_title_patterns"), list)
        else base.get("preferred_title_patterns", []) or []
    )
    merged["operating_rules"] = _unique_preserve_order(
        list(base.get("operating_rules", []) or []) + list(updates.get("operating_rules", []) or [])
    )
    merged["source_materials"] = _unique_preserve_order(
        updates.get("source_materials")
        if isinstance(updates.get("source_materials"), list)
        else base.get("source_materials", []) or []
    )
    merged["series"] = _merge_named_objects(
        list(base.get("series", []) or []),
        list(updates.get("series", []) or []),
        "slug",
    )

    base_rhythm = dict(base.get("publishing_rhythm") or {})
    updated_rhythm = dict(updates.get("publishing_rhythm") or {})
    merged_rhythm = _merge_dict(base_rhythm, updated_rhythm)
    merged_rhythm["calendar"] = _merge_named_objects(
        list(base_rhythm.get("calendar", []) or []),
        list(updated_rhythm.get("calendar", []) or []),
        "series",
    )
    merged["publishing_rhythm"] = merged_rhythm
    return _compact_strategy(merged)


def _active_series(strategy: dict[str, Any] | None) -> list[dict[str, Any]]:
    return [
        series
        for series in list((strategy or {}).get("series", []) or [])
        if _normalize_text(series.get("status")) not in {"arquivada", "archive", "archived"}
    ]


def _active_series_names(strategy: dict[str, Any] | None) -> list[str]:
    return [series.get("name") for series in _active_series(strategy) if series.get("name")]


def _find_series_name(strategy: dict[str, Any] | None, *keywords: str) -> str:
    for series in _active_series(strategy):
        haystack = " ".join(
            [
                series.get("name") or "",
                series.get("slug") or "",
                series.get("summary") or "",
                series.get("objective") or "",
            ]
        ).lower()
        if any(keyword in haystack for keyword in keywords):
            return series.get("name") or ""
    return ""


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


def _series_name_for_idea(video: dict[str, Any], strategy: dict[str, Any] | None = None) -> str:
    explicit = _normalize_text(video.get("recommended_series"))
    for series in _active_series(strategy):
        name = series.get("name") or ""
        slug = series.get("slug") or ""
        if explicit and explicit in {_normalize_text(name), _normalize_text(slug)}:
            return name
        if explicit and explicit in _normalize_text(name):
            return name

    text = " ".join(
        [
            video.get("title") or "",
            video.get("hook") or "",
            video.get("formato") or "",
        ]
    ).lower()

    react_keywords = (
        "react",
        "next.js",
        "nextjs",
        "frontend",
        "componente",
        "hook",
        "useeffect",
        "estado",
        "tailwind",
        "ui",
    )
    react_series = _find_series_name(strategy, "react", "next.js", "nextjs", "frontend")
    if react_series and any(keyword in text for keyword in react_keywords):
        return react_series

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
    radar_series = _find_series_name(strategy, "radar", "news", "noticia")
    if any(keyword in text for keyword in radar_keywords):
        return radar_series or "RADAR IA"

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
    virada_series = _find_series_name(strategy, "virada", "bastidor", "operacao", "sistema")
    if any(keyword in text for keyword in virada_keywords):
        return virada_series or "A Virada"

    active_series_names = _active_series_names(strategy)
    return active_series_names[0] if active_series_names else "Fora de serie"


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


def _normalize_key(value: Any) -> str:
    return _normalize_text(str(value or "")).replace(" ", "_").replace("-", "_")


def _status_score(value: Any) -> int:
    return {
        "pronto_gravar": 40,
        "thumbnail_pronta": 32,
        "rascunho": 24,
        "planejado": 18,
        "ideia": 12,
        "seed": 10,
        "publicado": -100,
    }.get(_normalize_key(value), 8)


def _urgency_score(value: Any) -> int:
    return {
        "altissima": 24,
        "alta": 18,
        "media": 10,
        "baixa": 4,
    }.get(_normalize_key(value), 6)


def _series_slot_index(strategy: dict[str, Any], series_name: str | None) -> int | None:
    calendar_items = list((strategy.get("publishing_rhythm") or {}).get("calendar", []) or [])
    normalized_series = _normalize_text(series_name)
    for index, item in enumerate(calendar_items):
        if _normalize_text(item.get("series")) == normalized_series:
            return index
    return None


def _series_history_signal(
    series_name: str,
    *,
    strategy: dict[str, Any],
    pattern_scores: dict[str, int],
    median_views: int,
    existing_titles: list[str],
) -> dict[str, Any]:
    normalized_series = _normalize_text(series_name)
    react_series = _normalize_text(_find_series_name(strategy, "react", "next.js", "nextjs", "frontend"))
    radar_series = _normalize_text(_find_series_name(strategy, "radar", "news", "noticia"))
    virada_series = _normalize_text(_find_series_name(strategy, "virada", "bastidor", "operacao", "sistema"))

    practical_avg = int(pattern_scores.get("practical_avg") or 0)
    business_avg = int(pattern_scores.get("business_avg") or 0)
    macro_news_avg = int(pattern_scores.get("macro_news_avg") or 0)
    operator_avg = int(pattern_scores.get("operator_avg") or 0)
    has_react_history = any(keyword in title for title in existing_titles for keyword in ("react", "next"))

    if normalized_series and normalized_series == react_series:
        score = 18
        if practical_avg and practical_avg >= median_views:
            score += 5
        if not has_react_history:
            score += 7
        return {
            "score": score,
            "note": "React na Pratica abre busca evergreen e ainda nao foi explorada com consistencia no historico.",
        }

    if normalized_series and normalized_series == virada_series:
        score = 12
        if operator_avg and operator_avg >= median_views:
            score += 6
        if business_avg and business_avg >= median_views:
            score += 3
        return {
            "score": score,
            "note": "A Virada reforca autoridade operacional e conversa com o sinal de bastidor/sistema do canal.",
        }

    if normalized_series and normalized_series == radar_series:
        score = 6
        note = "RADAR IA traz recorrencia, mas precisa aterrissar sempre em impacto pratico."
        if macro_news_avg and macro_news_avg >= median_views:
            score += 4
        if practical_avg and macro_news_avg and practical_avg > macro_news_avg:
            score -= 4
        return {"score": score, "note": note}

    score = 8
    if practical_avg and practical_avg >= median_views:
        score += 4
    return {
        "score": score,
        "note": "O canal reage melhor quando o tema vira metodo, sistema ou resultado concreto.",
    }


def _title_signal(title: str) -> dict[str, Any]:
    text = _normalize_text(title)
    score = 0
    hits: list[str] = []

    patterns = [
        ("jeito certo", 8, "usa formula 'jeito certo'"),
        ("3 erros", 8, "abre com erro concreto"),
        ("erro", 6, "promete corrigir um erro"),
        ("como", 4, "tem cara de metodo pratico"),
        ("sistema", 4, "mostra sistema ou prova"),
        ("fluxo", 4, "fala de fluxo operacional"),
        ("react", 5, "captura busca evergreen de dev"),
        ("next", 4, "captura busca de stack web"),
        ("claude code", 5, "aproveita termo quente do teu ecossistema"),
    ]
    for marker, marker_score, label in patterns:
        if marker in text:
            score += marker_score
            hits.append(label)

    if len(_clean_text(title)) <= 68:
        score += 2
        hits.append("titulo cabe melhor no mobile")

    return {"score": min(score, 18), "hits": hits[:3]}


def _title_overlap_penalty(title: str, existing_titles: list[str]) -> int:
    normalized_title = _normalize_text(title)
    if not normalized_title:
        return 0
    if normalized_title in existing_titles:
        return -30

    candidate_words = {word for word in re.split(r"[^a-z0-9]+", normalized_title) if len(word) >= 4}
    if not candidate_words:
        return 0

    max_overlap = 0
    for existing in existing_titles:
        existing_words = {word for word in re.split(r"[^a-z0-9]+", existing) if len(word) >= 4}
        max_overlap = max(max_overlap, len(candidate_words & existing_words))

    if max_overlap >= 5:
        return -10
    if max_overlap >= 3:
        return -4
    return 0


def _candidate_blockers(candidate: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    status = _normalize_key(candidate.get("status"))
    if status in {"ideia", "seed"}:
        blockers.append("Ainda esta so em ideia. Falta fechar estrutura minima.")
    elif status == "planejado":
        blockers.append("Ainda precisa virar thumbnail + roteiro final.")
    elif status == "rascunho":
        blockers.append("Tem direcao, mas ainda falta consolidar a versao final.")

    if not _clean_text(candidate.get("hook")):
        blockers.append("Falta hook claro dos primeiros segundos.")
    if not _clean_text(candidate.get("thumbnail_rule")):
        blockers.append("Falta regra de thumbnail definida ou aplicada.")
    return blockers


def _candidate_actions(candidate: dict[str, Any]) -> list[str]:
    actions: list[str] = []
    status = _normalize_key(candidate.get("status"))
    if status in {"ideia", "seed"}:
        actions.append("Fechar titulo e hook em 1 frase antes de roteirizar.")
    if status in {"planejado", "rascunho", "ideia", "seed"}:
        actions.append("Escolher thumbnail e prova visual antes da gravacao.")
    if not _clean_text(candidate.get("hook")):
        actions.append("Escrever hook com dor + promessa + prova em ate 20s.")
    actions.append("Confirmar CTA final alinhado com a serie.")
    return actions[:3]


def _build_recording_queue(
    *,
    strategy: dict[str, Any],
    videos_from_briefing: list[dict[str, Any]],
    series_health: list[dict[str, Any]],
    pattern_scores: dict[str, int],
    median_views: int,
    existing_titles: list[str],
) -> dict[str, Any]:
    health_by_name = {_normalize_text(item.get("name")): item for item in series_health}
    candidates_map: dict[str, dict[str, Any]] = {}

    def upsert_candidate(candidate: dict[str, Any]) -> None:
        title_key = _normalize_text(candidate.get("title"))
        if not title_key:
            return
        current = candidates_map.get(title_key)
        if current is None or _status_score(candidate.get("status")) > _status_score(current.get("status")):
            candidates_map[title_key] = candidate

    for video in videos_from_briefing:
        status = _normalize_key(video.get("status") or "ideia")
        if status == "publicado":
            continue
        series_name = _series_name_for_idea(video, strategy)
        series_meta = next((series for series in strategy.get("series", []) if series.get("name") == series_name), {})
        upsert_candidate(
            {
                "title": video.get("chosen_title") or video.get("title") or video.get("working_title"),
                "series": series_name,
                "status": video.get("status") or "ideia",
                "urgency": video.get("urgencia") or video.get("urgency") or "media",
                "hook": video.get("hook") or "",
                "source": "briefing",
                "source_label": "briefing atual",
                "thumbnail_rule": series_meta.get("thumbnail_rule") or "",
                "objective": series_meta.get("objective") or "",
                "promise": series_meta.get("promise") or "",
                "cta_focus": series_meta.get("cta_focus") or "",
            }
        )

    for series in strategy.get("series", []):
        if _normalize_text(series.get("status")) == "arquivada":
            continue
        planned_episodes = [episode for episode in list(series.get("episodes", []) or []) if _normalize_key(episode.get("status")) != "publicado"]
        for episode in planned_episodes[:3]:
            upsert_candidate(
                {
                    "title": episode.get("working_title") or episode.get("title"),
                    "series": series.get("name"),
                    "status": episode.get("status") or "planejado",
                    "urgency": "media",
                    "hook": episode.get("hook") or episode.get("thesis") or "",
                    "source": "strategy_episode",
                    "source_label": "estrategia da serie",
                    "thumbnail_rule": series.get("thumbnail_rule") or "",
                    "objective": series.get("objective") or "",
                    "promise": series.get("promise") or "",
                    "cta_focus": series.get("cta_focus") or "",
                }
            )

    queue: list[dict[str, Any]] = []
    for candidate in candidates_map.values():
        if not _clean_text(candidate.get("title")):
            continue
        series_name = candidate.get("series") or "Fora de serie"
        slot_index = _series_slot_index(strategy, series_name)
        slot_bonus = max(0, 8 - (slot_index or 0) * 2) if slot_index is not None else 0
        health = health_by_name.get(_normalize_text(series_name), {})
        series_signal = _series_history_signal(
            series_name,
            strategy=strategy,
            pattern_scores=pattern_scores,
            median_views=median_views,
            existing_titles=existing_titles,
        )
        title_signal = _title_signal(candidate.get("title") or "")
        overlap_penalty = _title_overlap_penalty(candidate.get("title") or "", existing_titles)
        pipeline_pressure = 6 if int(health.get("ideas_in_pipeline") or 0) == 0 else 0
        readiness = _status_score(candidate.get("status"))
        urgency = _urgency_score(candidate.get("urgency"))
        score = readiness + urgency + slot_bonus + pipeline_pressure + series_signal["score"] + title_signal["score"] + overlap_penalty

        why_now: list[str] = []
        if slot_index is not None:
            why_now.append(f"{series_name} ja tem slot fixo no calendario e precisa alimentar esse trilho.")
        if pipeline_pressure:
            why_now.append(f"{series_name} esta sem gordura no pipeline. Se nao gravar, a serie seca.")
        why_now.append(series_signal["note"])
        why_now.extend(title_signal["hits"])
        if readiness >= 32:
            why_now.append("Ja esta perto da camera. Ganha velocidade sobre ideias cruas.")
        elif readiness >= 18:
            why_now.append("Ja existe estrutura suficiente para sair do papel rapido.")
        if urgency >= 18:
            why_now.append("A urgencia declarada pede decisao nesta rodada.")
        if overlap_penalty < 0:
            why_now.append("Existe alguma sobreposicao com titulos ja publicados. Precisa lapidar o angulo.")

        blockers = _candidate_blockers(candidate)
        queue.append(
            {
                **candidate,
                "score": score,
                "slot_index": slot_index,
                "why_now": why_now[:5],
                "blockers": blockers,
                "actions": _candidate_actions(candidate),
                "score_breakdown": {
                    "readiness": readiness,
                    "urgency": urgency,
                    "series_fit": series_signal["score"],
                    "slot_bonus": slot_bonus,
                    "pipeline_pressure": pipeline_pressure,
                    "title_signal": title_signal["score"],
                    "overlap_penalty": overlap_penalty,
                },
            }
        )

    queue.sort(key=lambda item: (item.get("score", 0), _status_score(item.get("status")), _urgency_score(item.get("urgency"))), reverse=True)
    for index, candidate in enumerate(queue, start=1):
        candidate["rank"] = index

    strategy_focus = _compact_recording_focus(strategy.get("recording_focus"))
    focus_match = None
    if strategy_focus.get("title"):
        focus_match = next((candidate for candidate in queue if _normalize_text(candidate.get("title")) == _normalize_text(strategy_focus.get("title"))), None)

    current_focus = None
    if strategy_focus.get("title"):
        current_focus = {
            **strategy_focus,
            "is_pinned": True,
            "queue_position": focus_match.get("rank") if focus_match else None,
            "still_recommended": bool(focus_match),
            "stale": focus_match is None,
        }
    elif queue:
        top_candidate = queue[0]
        current_focus = {
            "series": top_candidate.get("series"),
            "title": top_candidate.get("title"),
            "status": top_candidate.get("status"),
            "source": top_candidate.get("source"),
            "reason": "Sem pauta fixada ainda. Esta e a melhor sugestao automatica do workspace.",
            "updated_at": "",
            "is_pinned": False,
            "queue_position": 1,
            "still_recommended": True,
            "stale": False,
        }

    decision_rules = [
        "Pautas prontas vencem ideia solta quando o objetivo e gravar nesta semana.",
        "Serie com slot fixo e pipeline vazio ganha pressao extra.",
        "O canal premia mais metodo, sistema e erro concreto do que noticia pura.",
        "Titulos com promessa clara e gancho mobile-friendly sobem na fila.",
    ]

    return {
        "recording_queue": queue[:6],
        "next_recording_recommendation": queue[0] if queue else {},
        "current_focus": current_focus or {},
        "decision_rules": decision_rules,
    }


def _build_strategy_hygiene(strategy: dict[str, Any], pipeline: dict[str, Any]) -> dict[str, Any]:
    active_series = _active_series(strategy)
    calendar_items = list((strategy.get("publishing_rhythm") or {}).get("calendar", []) or [])
    scheduled_series = {_normalize_text(item.get("series")) for item in calendar_items if item.get("series")}

    missing_promise = [series.get("name") for series in active_series if not _clean_text(series.get("promise"))]
    missing_cta = [series.get("name") for series in active_series if not _clean_text(series.get("cta_focus"))]
    missing_audience = [series.get("name") for series in active_series if not _clean_text(series.get("audience"))]
    unscheduled = [series.get("name") for series in active_series if _normalize_text(series.get("name")) not in scheduled_series]

    issues: list[str] = []
    if missing_promise:
        issues.append(f"Series sem promise clara: {', '.join(missing_promise)}.")
    if missing_cta:
        issues.append(f"Series sem CTA focus definido: {', '.join(missing_cta)}.")
    if missing_audience:
        issues.append(f"Series sem audience clara: {', '.join(missing_audience)}.")
    if unscheduled:
        issues.append(f"Series ativas fora do calendario: {', '.join(unscheduled)}.")

    weekly_long_videos = int((strategy.get("publishing_rhythm") or {}).get("weekly_long_videos") or 0)
    long_slots = len(
        [
            item
            for item in calendar_items
            if _normalize_text(item.get("format") or "longo") in {"longo", "long", "video longo"}
        ]
    )
    if weekly_long_videos and long_slots < weekly_long_videos:
        issues.append(
            f"Cadencia promete {weekly_long_videos} longos por semana, mas o calendario tem {long_slots} slots longos."
        )
    if pipeline.get("thumb_ready", 0) == 0:
        issues.append("Nao ha thumbnail pronta no pipeline agora.")
    if pipeline.get("ready_to_record", 0) == 0:
        issues.append("Nao ha video pronto para gravar no pipeline atual.")

    return {
        "active_series_count": len(active_series),
        "scheduled_slots": len(calendar_items),
        "weekly_long_videos": weekly_long_videos,
        "thumb_ready": pipeline.get("thumb_ready", 0),
        "ready_to_record": pipeline.get("ready_to_record", 0),
        "missing_promise_count": len(missing_promise),
        "missing_cta_count": len(missing_cta),
        "missing_audience_count": len(missing_audience),
        "unscheduled_count": len(unscheduled),
        "issues": issues,
    }


def _build_playbook_snapshot(strategy: dict[str, Any]) -> dict[str, Any]:
    source_materials = list(strategy.get("source_materials", []) or [])
    speaking_style = dict(strategy.get("speaking_style") or {})
    voice_core = dict(speaking_style.get("voice_core") or {})
    signature_elements = dict(speaking_style.get("signature_elements") or {})
    recording_focus = _compact_recording_focus(strategy.get("recording_focus"))
    return {
        "big_idea": strategy.get("big_idea") or "",
        "brand_narrative": strategy.get("brand_narrative") or "",
        "editorial_formula": strategy.get("editorial_formula") or "",
        "operating_rules": list(strategy.get("operating_rules", []) or [])[:6],
        "content_pillars": list(strategy.get("content_pillars", []) or [])[:6],
        "title_patterns": list(strategy.get("preferred_title_patterns", []) or [])[:6],
        "cta_templates": dict(strategy.get("cta_templates") or {}),
        "style": dict(strategy.get("style") or {}),
        "publishing_calendar": list((strategy.get("publishing_rhythm") or {}).get("calendar", []) or [])[:6],
        "series_summary": [
            {
                "name": series.get("name"),
                "cadence": series.get("cadence"),
                "promise": series.get("promise"),
                "status": series.get("status"),
            }
            for series in list(strategy.get("series", []) or [])[:6]
        ],
        "voice_promise_style": voice_core.get("promise_style") or "",
        "signature_phrases": list(signature_elements.get("high_frequency", []) or [])[:6],
        "source_materials": source_materials,
        "source_count": len(source_materials),
        "recording_focus": recording_focus,
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
    strategy = _merge_strategy(get_default_youtube_strategy(), stored_strategy or {})

    if persist_default and strategy != (stored_strategy or {}):
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
    strategy = _merge_strategy(get_default_youtube_strategy(), strategy_payload or {})
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
    active_series_names = _active_series_names(strategy)
    radar_series = _find_series_name(strategy, "radar", "news", "noticia")
    react_series = _find_series_name(strategy, "react", "next.js", "nextjs", "frontend")
    opportunity_gaps: list[str] = []
    for series_name in active_series_names:
        normalized_name = _normalize_text(series_name)
        if normalized_name and not any(normalized_name in title for title in existing_titles):
            opportunity_gaps.append(f"{series_name} ainda nao esta marcada como serie recorrente no historico do canal.")
    if radar_series and practical_avg > macro_news_avg:
        opportunity_gaps.append(f"Noticias puras tendem a performar pior que videos com metodo. {radar_series} precisa terminar em impacto pratico.")
    if react_series and not any(keyword in title for title in existing_titles for keyword in ("react", "next")):
        opportunity_gaps.append(f"{react_series} ainda nao tem historico publicado. Isso abre espaco para busca evergreen semanal.")
    if recent_avg_views and median_views and recent_avg_views < median_views:
        opportunity_gaps.append("Os ultimos videos estao abaixo da mediana historica. Falta reforcar thumbnail e promessa logo no titulo.")
    if not opportunity_gaps:
        opportunity_gaps.append("Oportunidade principal: serializar o que ja funcionou em vez de publicar temas isolados.")

    pipeline = _extract_pipeline_summary(latest_briefing)
    strategy_hygiene = _build_strategy_hygiene(strategy, pipeline)
    videos_from_briefing = list((latest_briefing or {}).get("videos", []) or [])
    lanes_map: dict[str, dict[str, Any]] = {}
    for series in strategy.get("series", []):
        lanes_map[series.get("name")] = {
            "series": series.get("name"),
            "objective": series.get("objective"),
            "ideas": [],
        }

    for video in videos_from_briefing:
        series_name = _series_name_for_idea(video, strategy)
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

    recording_decision = _build_recording_queue(
        strategy=strategy,
        videos_from_briefing=videos_from_briefing,
        series_health=series_health,
        pattern_scores={
            "practical_avg": practical_avg,
            "business_avg": business_avg,
            "macro_news_avg": macro_news_avg,
            "operator_avg": operator_avg,
        },
        median_views=median_views,
        existing_titles=existing_titles,
    )
    next_recording = dict(recording_decision.get("next_recording_recommendation") or {})
    current_focus = dict(recording_decision.get("current_focus") or {})

    calendar_items = list((strategy.get("publishing_rhythm") or {}).get("calendar", []) or [])
    calendar_text = ", ".join(
        [
            f"{item.get('series')} em {item.get('slot')}"
            for item in calendar_items
            if item.get("series") and item.get("slot")
        ]
    )
    next_actions: list[str] = [
        (
            f"Fixar o calendario editorial: {calendar_text}."
            if calendar_text
            else "Fixar o calendario editorial com slot definido para cada serie ativa."
        ),
        "Toda pauta nova precisa nascer com serie, promessa e CTA definidos. Sem video solto fora das trilhas principais.",
    ]
    if next_recording:
        next_actions.append(
            f"Gravar agora: '{next_recording.get('title', 'proxima pauta')}' em {next_recording.get('series', 'serie indefinida')}."
        )
    if pipeline.get("thumb_ready", 0) == 0:
        next_actions.append("Escolher pelo menos 1 video do pipeline e fechar thumbnail hoje.")
    if pipeline.get("ready_to_record", 0) == 0 and videos_from_briefing:
        next_actions.append("Subir 1 pauta para pronto_gravar antes de gerar novas ideias.")
    if videos_from_briefing:
        next_actions.append(f"Priorizar '{videos_from_briefing[0].get('title', 'proxima pauta')}' no proximo ciclo.")
    if react_series:
        next_actions.append(f"Na {react_series}, priorizar bug, interface ou arquitetura real antes de tutorial generico.")
    if radar_series:
        next_actions.append(f"No {radar_series}, fechar sempre com a pergunta: isso vira projeto, servico ou nao?")

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
        "strategy_hygiene": strategy_hygiene,
        "series_health": series_health,
        "series_lanes": series_lanes,
        "recording_queue": recording_decision.get("recording_queue", []),
        "next_recording_recommendation": next_recording,
        "current_focus": current_focus,
        "decision_rules": recording_decision.get("decision_rules", []),
        "next_actions": next_actions,
        "latest_briefing": latest_briefing,
    }


def _strategy_context_text(strategy_context: dict[str, Any] | None) -> str:
    if not strategy_context:
        return "Sem estrategia adicional."
    calendar = list((strategy_context.get("publishing_rhythm") or {}).get("calendar", []) or [])
    lines = [
        f"- Objetivo: {strategy_context.get('goal', 'Motor 100K')}",
        f"- Posicionamento: {strategy_context.get('positioning', '')}",
    ]
    if calendar:
        lines.append(
            "- Calendario: "
            + " | ".join(
                [
                    f"{item.get('series')} em {item.get('slot')}"
                    for item in calendar
                    if item.get("series") and item.get("slot")
                ]
            )
        )
    for rule in list(strategy_context.get("operating_rules", []) or [])[:5]:
        lines.append(f"- Regra: {rule}")
    for series in strategy_context.get("series", []):
        lines.append(
            (
                f"- Serie {series.get('name')}: {series.get('summary')} | Cadencia: {series.get('cadence')} "
                f"| Promessa: {series.get('promise', '')} | CTA: {series.get('cta_focus', '')}"
            )
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
                f"Gere ideias de video alinhadas a estas series: {', '.join(_active_series_names(strategy_context)) or 'series ativas da estrategia'}. "
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
