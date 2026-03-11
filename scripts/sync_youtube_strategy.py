#!/usr/bin/env python
"""
Sync the GuyFolkz YouTube playbook from local planning files into Orquestra.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request


DEFAULT_API_URL = "https://orquestra-backend.jz9bd8.easypanel.host"
DEFAULT_PROJECT_NAME = "GuyFolkz"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_workspace_root() -> Path:
    return repo_root().parent / "orquestrador"


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def deep_merge(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def markdown_value(section: str, labels: list[str]) -> str:
    for label in labels:
        pattern = re.compile(rf"\*\*{re.escape(label)}:\*\*\s*(.+)")
        match = pattern.search(section)
        if match:
            return match.group(1).strip()
    return ""


def parse_shorts(section: str) -> list[str]:
    raw = markdown_value(section, ["Shorts derivados"])
    if not raw:
        return []
    parts = re.split(r"\s*\d+\)\s*", raw)
    return [part.strip(" -") for part in parts if part.strip(" -")]


def parse_a_virada(markdown: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    season = {
        "mother_promise": markdown_value(markdown, ["Promessa-mae", "Promessa-mãe"]),
        "season_cta": markdown_value(markdown, ["CTA da temporada"]),
        "duration_target": markdown_value(markdown, ["Duracao alvo", "Duração alvo"]),
        "format": markdown_value(markdown, ["Formato"]),
    }

    pattern = re.compile(r"^##\s+(EP\d+)\s+(.+)$", re.MULTILINE)
    matches = list(pattern.finditer(markdown))
    episodes: list[dict[str, Any]] = []

    for index, match in enumerate(matches):
        section_end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        section = markdown[match.start():section_end]
        raw_heading = match.group(2).strip()
        heading_title = re.sub(r"^[^A-Za-z0-9]+", "", raw_heading).strip()
        episode_number = int(match.group(1).replace("EP", ""))
        youtube_title = markdown_value(section, ["YouTube Title"]) or heading_title
        thesis = markdown_value(section, ["Tese"])
        objective = markdown_value(section, ["Objetivo comercial"])
        episodes.append(
            {
                "code": f"AV-{episode_number:02d}",
                "title": youtube_title,
                "working_title": heading_title,
                "thesis": thesis,
                "commercial_goal": objective,
                "shorts_ideas": parse_shorts(section),
                "status": "planejado",
            }
        )

    return season, episodes


def build_strategy_payload(
    channel_profile: dict[str, Any],
    speaking_style: dict[str, Any],
    radar_episode: dict[str, Any],
    a_virada_markdown: str,
    source_materials: list[Path],
) -> dict[str, Any]:
    a_virada_season, a_virada_episodes = parse_a_virada(a_virada_markdown)
    radar_meta = dict(radar_episode.get("meta") or {})
    radar_episodes = [
        {
            "code": "RI-01",
            "title": radar_meta.get("youtube_title") or radar_meta.get("title") or "RADAR IA #01",
            "working_title": radar_meta.get("title") or "RADAR IA #01",
            "hook": (radar_episode.get("segments") or [{}])[0].get("text", ""),
            "commercial_goal": "recorrencia + descoberta + repertorio",
            "status": "rascunho",
        },
        {"code": "RI-02", "title": "RADAR IA #02", "status": "planejado"},
        {"code": "RI-03", "title": "RADAR IA #03", "status": "planejado"},
        {"code": "RI-04", "title": "RADAR IA #04", "status": "planejado"},
    ]
    radar_idea_seeds = [
        radar_meta.get("youtube_title") or radar_meta.get("title") or "RADAR IA #01",
        "RADAR IA: o que muda para automacao B2B nessa semana",
        "RADAR IA: as 3 noticias que realmente importam para quem vende automacao",
        "RADAR IA: o que e hype e o que vira projeto pago",
    ]

    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    return {
        "version": 2,
        "goal": "Motor 100K",
        "north_star": "YouTube como topo de funil para gerar leads B2B no WhatsApp",
        "positioning": channel_profile.get("positioning") or "automacao pratica, IA aplicada, agentes e sistemas reais",
        "big_idea": channel_profile.get("big_idea") or "",
        "brand_narrative": channel_profile.get("brand_narrative") or "",
        "editorial_formula": channel_profile.get("editorial_formula") or "",
        "style": dict(channel_profile.get("style") or {}),
        "content_pillars": list(channel_profile.get("content_pillars") or []),
        "preferred_title_patterns": list(channel_profile.get("preferred_title_patterns") or []),
        "thumbnail_rules": dict(channel_profile.get("thumbnail_rules") or {}),
        "hook_rules": dict(channel_profile.get("hook_rules") or {}),
        "cta_templates": dict(channel_profile.get("cta_templates") or {}),
        "forbidden": list(channel_profile.get("forbidden") or []),
        "mascot": dict(channel_profile.get("mascot") or {}),
        "speaking_style": speaking_style,
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
        "source_materials": [str(path) for path in source_materials],
        "last_synced_at": timestamp,
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
                "season": a_virada_season,
                "idea_seeds": [episode["title"] for episode in a_virada_episodes[:4]],
                "episodes": a_virada_episodes,
            },
            {
                "slug": "radar-ia",
                "name": "RADAR IA",
                "status": "ativa",
                "objective": "Criar habito semanal e puxar publico frio com noticias filtradas pelo impacto pratico.",
                "content_role": "topo/meio de funil",
                "cadence": "1 episodio por semana",
                "format": "video longo 8-12min",
                "thumbnail_rule": radar_meta.get("thumbnail_concept") or "uma manchete dominante + take forte do Diego",
                "summary": "Curadoria semanal: o que importa em IA e como isso afeta negocio, automacao e servico.",
                "season": {
                    "cta": radar_meta.get("cta") or "Inscreva-se para o proximo RADAR IA",
                    "duration_target": radar_meta.get("duration_target") or "10:00",
                    "segments_count": radar_meta.get("segments_count") or 0,
                },
                "idea_seeds": radar_idea_seeds,
                "episodes": radar_episodes,
            },
        ],
    }


def api_request(method: str, url: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    req = request.Request(url, method=method, headers=headers, data=data)
    try:
        with request.urlopen(req, timeout=60) as response:
            content = response.read().decode("utf-8")
            return json.loads(content) if content else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {exc.code} {body}") from exc


def sync_to_api(api_url: str, token: str, project_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    query = parse.urlencode({"project_name": project_name})
    base_url = api_url.rstrip("/")
    strategy_url = f"{base_url}/api/youtube/strategy?{query}"
    current = api_request("GET", strategy_url, token)
    current_strategy = ((current or {}).get("data") or {}).get("strategy") or {}
    merged = deep_merge(current_strategy, payload)
    saved = api_request("PUT", strategy_url, token, {"strategy": merged})
    return ((saved or {}).get("data") or {}).get("strategy") or merged


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sync GuyFolkz YouTube strategy into Orquestra.")
    parser.add_argument("--workspace-root", type=Path, default=default_workspace_root(), help="Base path that contains video-factory and the markdown file.")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="Orquestra backend base URL.")
    parser.add_argument("--project-name", default=DEFAULT_PROJECT_NAME, help="Project name in Orquestra.")
    parser.add_argument("--token", default="", help="Bearer token. Defaults to APP_SECRET_KEY from .env.")
    parser.add_argument("--apply", action="store_true", help="Persist the generated strategy via API.")
    parser.add_argument("--output", type=Path, help="Optional path to write the generated JSON payload.")
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    workspace_root = args.workspace_root.resolve()
    video_factory_root = workspace_root / "video-factory"
    source_materials = [
        video_factory_root / "memory" / "channel-profile.json",
        video_factory_root / "memory" / "diego-speaking-style.json",
        video_factory_root / "scripts" / "radar-ia-ep01.json",
        workspace_root / "roteiros_serie1_a_virada.md",
    ]

    missing = [str(path) for path in source_materials if not path.exists()]
    if missing:
        parser.error(f"Missing input files: {', '.join(missing)}")

    channel_profile = read_json(source_materials[0])
    speaking_style = read_json(source_materials[1])
    radar_episode = read_json(source_materials[2])
    a_virada_markdown = read_text(source_materials[3])

    payload = build_strategy_payload(
        channel_profile=channel_profile,
        speaking_style=speaking_style,
        radar_episode=radar_episode,
        a_virada_markdown=a_virada_markdown,
        source_materials=source_materials,
    )

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    result = payload
    if args.apply:
        env_values = parse_env(repo_root() / ".env")
        token = args.token or env_values.get("APP_SECRET_KEY", "")
        if not token:
            parser.error("Missing token. Pass --token or set APP_SECRET_KEY in .env.")
        result = sync_to_api(args.api_url, token, args.project_name, payload)

    summary = {
        "project_name": args.project_name,
        "series": [series.get("name") for series in payload.get("series", [])],
        "a_virada_episodes": len((payload.get("series", [{}])[0] or {}).get("episodes", [])),
        "radar_episodes": len((payload.get("series", [{}, {}])[1] or {}).get("episodes", [])),
        "content_pillars": len(payload.get("content_pillars", [])),
        "source_count": len(payload.get("source_materials", [])),
        "applied": args.apply,
        "last_synced_at": result.get("last_synced_at") or payload.get("last_synced_at"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
