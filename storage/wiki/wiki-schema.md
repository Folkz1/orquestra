# Wiki da Orquestra — Schema e Convenções

> Este arquivo define as convenções de formato de todas as páginas da wiki.
> Leia este arquivo ANTES de editar ou gerar qualquer página.

---

## Estrutura de Toda Página

```markdown
---
last_updated: YYYY-MM-DD
sources:
  - orquestra:contact:{id}   # ou recording:{id} ou project:{id}
staleness_tier: daily|weekly|monthly|permanent
confidence: high|medium|low
---

# Nome da Entidade

> Resumo de 1 linha — Pipeline: `stage` | Contexto rápido

## Seção Principal
...

---
*Atualizado em YYYY-MM-DD HH:MM UTC pelo wiki da Orquestra*
```

---

## Staleness Tiers

| Tier | Frequência de atualização esperada |
|---|---|
| `daily` | Contatos com atividade diária (WhatsApp, pipeline) |
| `weekly` | Projetos, clientes ativos sem mensagens diárias |
| `monthly` | Contatos de baixa atividade |
| `permanent` | Gravações (calls são imutáveis após análise) |

---

## Tipos de Página

### contacts/{slug}.md
- Frontmatter: `staleness_tier: daily`
- Seções obrigatórias: Status Comercial
- Seções opcionais: Notas, Propostas, Projetos Relacionados, Calls, Histórico WhatsApp, Contexto Operacional, Decisões Históricas, Action Items Pendentes
- Resumo (linha `>`): `Contato WhatsApp | Pipeline: \`stage\` | Ultima msg: DD/MM/YYYY`

### projects/{slug}.md
- Frontmatter: `staleness_tier: weekly`
- Seções obrigatórias: descrição ou stack
- Seções opcionais: Keywords, URLs e Infra, Métricas, Dono e Contatos, Propostas, Tasks Abertas, Calls
- Resumo (linha `>`): `Projeto | Status: \`status\` | Criado em: DD/MM/YYYY`

### recordings/{slug}.md
- Frontmatter: `staleness_tier: permanent` (calls não mudam)
- Seções obrigatórias: data e duração
- Seções opcionais: Tópicos, Resumo, Decisões, Action Items, Transcrição
- Resumo (linha `>`): `Gravacao de DD/MM/YYYY | Duracao: Xm00s`

---

## index.md — Formato

```markdown
# Wiki da Orquestra — Index Semântico

> Base de conhecimento incremental. Atualizado em DD/MM/YYYY.
> Entidades: N contatos | N projetos | N gravacoes

## Projetos Ativos (N)

- [[Nome do Projeto]] — Resumo de 1 linha extraído do .md

## Contatos (N)

- [[Nome do Contato]] — Pipeline: stage | Última msg: data

## Gravacoes (N)

- [[Titulo da Gravacao]] — Resumo breve
```

---

## log.md — Formato Parseável

```markdown
# Log de Operações da Wiki

> Formato: `## [timestamp] operacao | detalhe`

## [2026-04-17 10:30 UTC] rebuild | 7c 22r 5p
- contatos: 7 | gravacoes: 22 | projetos: 5

## [2026-04-17 14:15 UTC] ingest | Emilio call #07 — resumo da call
- contatos: 0 | gravacoes: 1 | projetos: 0
```

**Operações válidas:** `rebuild`, `ingest`, `lint`, `memory-push`

---

## Wikilinks

- Sempre usar `[[Nome Exato]]` para referenciar outras entidades
- O nome deve bater exatamente com o `# Titulo` da página de destino
- O grafo Cytoscape.js extrai edges via regex `\[\[([^\]]+)\]\]`

---

## Anti-patterns (não fazer)

- ❌ Não hardcode datas em texto — usar `_fmt_date()` ou `_now()`
- ❌ Não incluir secrets (tokens, senhas) em nenhuma página
- ❌ Não criar páginas sem frontmatter YAML
- ❌ Não usar headings `###` como seção principal — use `##`
- ❌ Não deixar wikilinks quebrados — verificar no lint periódico

---

*Schema v1.0 — Criado em 2026-04-17 | Mantido pelo wiki da Orquestra*
