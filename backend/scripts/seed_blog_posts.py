#!/usr/bin/env python3
"""
Seed inicial de posts do blog para os videos YouTube publicados.
Rodar 1x: python scripts/seed_blog_posts.py
"""

import os
import httpx

BASE = os.getenv("ORQUESTRA_URL", "https://orquestra-backend.jz9bd8.easypanel.host")
SECRET = os.getenv("ORQUESTRA_SECRET", "orquestra-secret-key-2026")
HEADERS = {"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"}

POSTS = [
    {
        "title": "Crianca de 15 Anos Fez $30K Instalando IA: O Dinheiro Ta em Instalar, Nao Criar",
        "subtitle": "React ao video do Nate Herkelman: como um garoto de 15 anos faturou $30K ensinando empresas a instalar Claude Code",
        "youtube_video_id": "mOWCESTADMw",
        "video_type": "long",
        "tags": ["claude-code", "automacao", "negocio", "react"],
        "reading_time_min": 6,
        "cover_image_url": "https://i.ytimg.com/vi/mOWCESTADMw/maxresdefault.jpg",
        "content_md": """# Crianca de 15 Anos Fez $30K Instalando IA

Assisti ao video do Nate Herkelman e precisei comentar ao vivo. O garoto tem 15 anos e faturou $30K em 2-3 semanas instalando Claude Code para empresas.

## O Insight Principal

**O dinheiro nao esta em criar IA. Esta em instalar e configurar pra quem nao sabe.**

Isso muda tudo. A maioria das empresas quer resultado, nao quer aprender como a tecnologia funciona. Elas pagam quem resolve o problema.

## O que o Nate fez na pratica

- Identificou empresas que precisavam automatizar tarefas repetitivas
- Instalou e configurou Claude Code no ambiente delas
- Cobrou pelo resultado, nao pelo tempo
- $30K em semanas, com 15 anos

## Por que funciona no Brasil tambem

O Brasil tem um deficit enorme de profissionais que sabem instalar e configurar IA em ambiente real. As ferramentas existem (Claude Code, N8N, ElevenLabs), mas pouquissimas pessoas sabem colocar em producao.

**Isso e uma janela de oportunidade de 12-18 meses.** Depois que todo mundo souber, o preco cai.

## O que aprendi assistindo

Nao precisa criar uma startup de IA. Nao precisa financiamento. Nao precisa esperar. Precisa saber instalar e mostrar resultado.

A skill de instalar IA em producao vale muito mais do que parece.

## Proximos passos

Estou documentando meu processo de instalacao e configuracao aqui no canal. Cada video e um experimento real, com dados reais, nos meus projetos ativos.""",
    },
    {
        "title": "App de R$100M Vibe Codado por Moleque de 18 Anos: Cal AI",
        "subtitle": "React ao Cal AI do Nate Herkelman: como um app de calculadora de calorias virou empresa de $100M com vibe coding",
        "youtube_video_id": "WV3Qf8vtuRk",
        "video_type": "long",
        "tags": ["vibe-coding", "startup", "ia", "react"],
        "reading_time_min": 5,
        "cover_image_url": "https://i.ytimg.com/vi/WV3Qf8vtuRk/sddefault.jpg",
        "content_md": """# App de R$100M Vibe Codado por Moleque de 18 Anos

O Cal AI do Zach Yadegari. 18 anos. App de escaneamento de comida com IA. Valuacao de $100M.

## O que e vibe coding de verdade

Vibe coding nao e so escrever prompt e publicar. E um ciclo de:

1. **Ideia** — identificar problema real com mercado
2. **Prompt** — construir rapido com IA como parceira
3. **Iteracao** — testar com usuarios reais, ajustar
4. **Distribuicao** — crescer antes de refatorar

O Zach nao ficou semanas polindo codigo. Lancou, coletou feedback, iterou.

## Por que isso nao e so "vibe"

A narrativa de "vibe coding e irresponsavel" esta errada. O que o Zach fez foi **produto primeiro, engenharia depois**.

Quando voce tem tracoes (usuarios, receita, dados), voce sabe o que vale a pena engenheirar. Construir arquitetura perfeita sem validacao de mercado e o desperdicio real.

## O que aprendi

- Distribuicao > perfeicao tecnica no inicio
- IA como co-fundador tecnico funciona pra MVPs
- A janela de construir rapido ainda esta aberta

## Minha aplicacao pratica

Estou usando esse mesmo principio no LicitaAI: lancei MVP funcional, estou coletando feedback de usuarios reais, e so entao estou refinando o que realmente importa.""",
    },
    {
        "title": "Skills sao Democracia do Know-how",
        "subtitle": "Como skills de IA funcionam como democratizacao do conhecimento especializado",
        "youtube_video_id": "ZWjUHgYf6qo",
        "video_type": "short",
        "tags": ["skills", "ia", "conhecimento", "automacao"],
        "reading_time_min": 2,
        "cover_image_url": "https://i.ytimg.com/vi/ZWjUHgYf6qo/maxresdefault.jpg",
        "content_md": """# Skills = Democracia do Know-how

Uma skill de IA e essencialmente um prompt que encapsula conhecimento especializado.

## O que isso significa na pratica

Antes, para fazer analise de contratos juridicos, voce precisava de um advogado. Com uma skill bem construida, qualquer um consegue um primeiro filtro de qualidade.

**Isso e democratizacao real.** O know-how que estava trancado no cerebro de especialistas agora pode ser distribuido em escala.

## Por que isso importa pra voce

Se voce tem conhecimento especializado em qualquer area, voce pode criar uma skill. E isso pode virar produto, servico ou vantagem competitiva.

## O perigo

Skills sem harness falham em producao. Para uso pessoal, 85-95% de confiabilidade e ok. Para comercial, precisa de estrutura de validacao em cima.""",
    },
    {
        "title": "Matrix na vida real: plugar e saber",
        "subtitle": "A IA esta fazendo pela habilidade o que o Google fez pelo conhecimento factual",
        "youtube_video_id": "M75KoELV4ls",
        "video_type": "short",
        "tags": ["ia", "skills", "matrix", "futuro"],
        "reading_time_min": 2,
        "cover_image_url": "https://i.ytimg.com/vi/M75KoELV4ls/maxresdefault.jpg",
        "content_md": """# Matrix na vida real: plugar e saber

Lembra da cena do Matrix onde o Neo aprende kung fu em segundos?

## Isso esta acontecendo

Nao com habilidades fisicas ainda, mas com conhecimento e habilidades cognitivas. Uma pessoa com as skills certas de IA consegue em horas o que antes levava anos de especializacao.

## O que muda

**Antes:** aprende por anos, depois aplica
**Agora:** aplica com skill, aprende no processo

A curva de aprendizado para gerar valor colapsou.

## O que nao muda

Julgamento. Contexto. Relacionamento. A habilidade de saber **qual** skill usar e **quando** ainda e completamente humana.

Quem entende isso primeiro tem vantagem enorme.""",
    },
    {
        "title": "IA NAO e bolha (e eu provo)",
        "subtitle": "Dados e argumentos contra a narrativa de que IA e apenas hype",
        "youtube_video_id": "2fwo7Inuxaw",
        "video_type": "short",
        "tags": ["ia", "bolha", "mercado", "dados"],
        "reading_time_min": 3,
        "cover_image_url": "https://i.ytimg.com/vi/2fwo7Inuxaw/maxresdefault.jpg",
        "content_md": """# IA NAO e bolha (e eu provo)

Toda semana alguem fala que IA e bolha. Eu discordo com dados.

## O que uma bolha real parece

Uma bolha tem receita inexistente, valuacoes baseadas em pura especulacao e nenhuma utilidade real. Veja a .com de 2000.

## O que IA tem

- **Receita real**: OpenAI, Anthropic, Google AI — receitas crescendo exponencialmente
- **Uso real**: milhoes de pessoas resolvendo problemas reais todo dia
- **Redutores de custo**: empresas economizando dinheiro de verdade

## Meu caso concreto

No LicitaAI, o custo de analise por edital caiu 10x com IA comparado ao humano. Isso e reducao de custo mensuravel, nao especulacao.

No IssueMapper, automacao de deteccao de erros que antes precisava de time manual.

## A narrativa de bolha serve a quem?

Para quem ainda nao entendeu a transicao. Enquanto debatem se e bolha, outros estao construindo em cima da infra.""",
    },
    {
        "title": "O agente configurou OUTRO agente sozinho",
        "subtitle": "Experimento real: Claude Code criando e configurando um sub-agente autonomamente",
        "youtube_video_id": "B148ej5BiCc",
        "video_type": "short",
        "tags": ["agentes", "claude-code", "automacao", "experimento"],
        "reading_time_min": 2,
        "cover_image_url": "https://i.ytimg.com/vi/B148ej5BiCc/maxresdefault.jpg",
        "content_md": """# O agente configurou OUTRO agente sozinho

Experimento real que fiz no orquestrador Jarbas.

## O que aconteceu

Pedi pro Claude Code (agente principal) criar uma skill nova. Ele nao so criou o codigo, como configurou o proprio ambiente para usar essa skill, criou o arquivo de configuracao e testou a integracao.

**Um agente criando outro agente.** Em producao.

## Por que isso importa

Isso e o inicio de sistemas agentes auto-organizaveis. Nao e teoria — e algo que aconteceu no meu ambiente de desenvolvimento hoje.

## O limite atual

Ainda precisa de supervisao humana. Os agentes cometem erros, especialmente em decisoes de arquitetura mais complexas. A confiabilidade ainda nao esta em nivel de autonomia total.

## O que estou construindo

O Jarbas Orchestrator e exatamente isso: um sistema de agentes onde cada um tem responsabilidades especificas e pode delegar para sub-agentes. Documeto tudo aqui.""",
    },
    {
        "title": "CRIANCA DE 15 ANOS FEZ $30K com IA",
        "subtitle": "A versao curta: o insight mais importante sobre fazer dinheiro com IA em 2026",
        "youtube_video_id": "92mUepb3ehs",
        "video_type": "short",
        "tags": ["ia", "dinheiro", "claude-code", "oportunidade"],
        "reading_time_min": 2,
        "cover_image_url": "https://i.ytimg.com/vi/92mUepb3ehs/maxresdefault.jpg",
        "content_md": """# CRIANCA DE 15 ANOS FEZ $30K com IA

O insight rapido: o garoto nao criou IA. Instalou.

## O modelo de negocio

1. Empresa quer resultado com IA
2. Nao tem tempo/skill pra instalar
3. Voce instala e configura
4. Cobra pelo resultado

**Simples assim.**

## Por que 15 anos conseguiu

Porque a barreira nao e idade, diploma ou capital. E saber usar as ferramentas.

Claude Code, N8N, ElevenLabs — tudo tem documentacao publica. Quem investe tempo aprendendo tem vantagem imediata.

## A janela esta aberta

Em 12-18 meses isso vai estar comoditizado. Quem aprender agora vai cobrar muito mais que quem aprender depois.""",
    },
    {
        "title": "A IA ganhando KNOW-HOW",
        "subtitle": "Como skills de IA encapsulam e distribuem conhecimento especializado",
        "youtube_video_id": "TGTjbMxpTAk",
        "video_type": "short",
        "tags": ["skills", "know-how", "ia", "conhecimento"],
        "reading_time_min": 2,
        "cover_image_url": "https://i.ytimg.com/vi/TGTjbMxpTAk/maxresdefault.jpg",
        "content_md": """# A IA ganhando KNOW-HOW

A diferenca entre uma skill boa e uma skill ruim e o know-how encapsulado.

## O que e know-how na pratica

Know-how e o conhecimento tacito — o que voce sabe mas nao consegue escrever num manual. O jeito de fazer que veio de anos de experiencia.

Exemplo: um advogado experiente sabe identificar clausulas abusivas em 30 segundos. Isso e know-how.

## Como encapsular em skill

1. Mapeie as decisoes que o especialista toma
2. Documente os casos de borda
3. Escreva exemplos (few-shot) com o raciocinio
4. Valide com o especialista
5. Itere

**Uma skill com know-how real e muito mais valiosa que uma skill generica.**

## Meu processo

Cada skill que crio para os projetos dos clientes passa por esse processo. E isso que justifica o preco.""",
    },
]


def main():
    client = httpx.Client()
    for post in POSTS:
        try:
            r = client.post(f"{BASE}/api/blog", headers=HEADERS, json=post, timeout=30)
            if r.status_code in (200, 201):
                data = r.json()
                print(f"[OK] {data['slug']}")
            else:
                print(f"[ERRO] {post['title'][:50]} -> {r.status_code}: {r.text[:100]}")
        except Exception as e:
            print(f"[EXCECAO] {post['title'][:50]} -> {e}")


if __name__ == "__main__":
    main()
