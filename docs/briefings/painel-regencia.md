# Briefing — Painel de Regência na Orquestra (gates · contas · KPIs, com série no tempo)

> Passo 1.5 da skill `/jarbas`. Ordem do Diego, 09/09/2026 ~16:15Z, literal: «os kpis e telemetria precisam
> atualizar na nossa página de gates usada aqui ou uma nova facilmente atualizada com novos gates na orquestra
> e que conseguimos acessar o painel e ver os dados durante o tempo e talvez até dados passados que temos já
> como medir!». Escrito antes da primeira linha de código, depois de ler a Orquestra (auth, routers, Alembic,
> Cockpit), a Mesa de Gates (HTML + registo) e os coletores do cérebro. Branch `feat/painel-regencia`.

## 1. O problema, do ponto de vista do Diego

Ele decide em dois momentos e no meio quer VER: quais gates estão à espera dele (com as opções e a
consequência de cada uma), quanto cada conta Claude já gastou e a que velocidade, e o que as sessões estão a
entregar. Hoje isso está em três sítios que não conversam:

- **Mesa de Gates** (artefato do Claude, `0a37284a…`): bonita e no telemóvel, mas só UMA sessão consegue
  escrever no registo dela (`write_db`), cada gate novo exige republicar o HTML, e a telemetria é um documento
  único sobrescrito: **não há série histórica**. As respostas ficam gravadas, mas a hora de abertura de cada
  gate não existe (os docs `gates` não têm `ts`).
- **Cockpit da Orquestra** (`/cockpit`): virou lixeira com 49 perguntas. Não se reaproveita porque (1) modela a
  pergunta como `project_tasks` genérica por `metadata_json.kind`, sem estado *expirado*, sem opções com
  consequência nem recomendação; (2) a lista não separa aberto/respondido/expirado por prazo, e por isso tudo
  o que envelhece fica igual ao que importa; (3) a telemetria que já vai para lá (`telemetria-push.js`, kind
  `telemetria_tokens`) é um doc único, de propósito sem histórico. O que se reaproveita dele: o padrão visual
  dos cartões, o cliente de API e o Bearer.
- **Disco e placar**: logs do tick nas duas máquinas, `usage-real.json`, `_hub-placar.md`. São leituras com
  hora que ninguém consegue ver num gráfico.

## 2. O desenho (é código e dados; o modelo não julga nada aqui)

**Casa:** Orquestra (`backend/app/routers/painel.py`, página `/painel`). Autenticação = o mesmo Bearer do
resto (`APP_SECRET_KEY`, middleware em `main.py`); nada público. Produção em
`https://orquestra-backend.jz9bd8.easypanel.host`, frontend em `https://guyyfolkz.mbest.site`.

### 2a. Modelo de dados (migration Alembic `026_painel_regencia`, sobre `025_add_testing_tables`)

| Tabela | Colunas | Nota |
|---|---|---|
| `painel_gates` | `id` texto PK (código do gate, ex. `GD24`) · `projeto` · `projeto_nome` · `titulo` · `why` · `ctx` json (lista de parágrafos) · `opts` json (lista `[letra, rótulo, consequência]`) · `rec` · `urg` bool · `estado` (`aberto`/`respondido`/`expirado`) · `escolha` · `nota` · `ts_aberto` · `ts_resposta` · `ts_expira` · `origem` · `extra` json · `criado_em` · `atualizado_em` | `ts_aberto` pode ser nulo: a Mesa nunca guardou a hora de abertura e não se inventa. `extra` guarda o que a Mesa tinha fora do modelo (`texto`, `feitoEm`, `tsApp`) e o histórico de respostas trocadas. |
| `painel_telemetria` | `id` · `ts` · `conta` (nome, nunca e-mail) · `limites` json (`[{kind, rotulo, percent, reseta}]`) · `usd` · `nivel` · `fonte` · `extra` json | **Uma linha por leitura e por conta, série completa.** Única por `(ts, conta, fonte)`: o mesmo tick reenviado não duplica. |
| `painel_kpi` | `id` · `dia` · `frente` · `metrics` json · `fonte` · `criado_em` · `atualizado_em` | Única por `(dia, frente, fonte)`: cada coletor escreve as suas métricas; o painel mostra o que existe e escreve «não medido» no que falta. |

### 2b. Quem escreve, quem lê, e o contrato de cada escrita

| Escrita | Quem | Contrato |
|---|---|---|
| `POST /api/painel/telemetria` | cron do jarbas (`telemetria-tick.js --aqui --postOrquestra`, a cada 10 min) e o hook do PC do Diego (`--remoto`) | corpo = o mesmo JSON do `--paraMesa` (sem e-mails); `ts` = `colhidoEm`; grava 1 linha por conta com `fonte` = hostname (ou `fonte` do corpo). Aceita também uma lista de leituras (backfill). Resposta `{gravadas, ignoradas}`. Segredo só do `.env`/ambiente, nunca em argv ou log. |
| `POST /api/painel/gates` (e `/gates/lote`) | regência (API) e importador da Mesa | upsert por `id`. Cria ou atualiza texto/opções/recomendação/urgência; **nunca** toca em `escolha`/`nota`/`estado` de um gate já respondido. `ts_aberto` só se vier no corpo. |
| `PATCH /api/painel/gates/{id}` | o Diego no browser; regência quando repassa uma resposta dada noutro canal | `{escolha, nota}` → `estado=respondido`, `ts_resposta=now` (ou o `ts_resposta` do corpo, para importar respostas antigas). `{estado:"expirado"}` marca expirado; `{estado:"aberto"}` reabre. Resposta anterior, se existir, vai para `extra.historico`. |
| `POST /api/painel/kpi` | coletores (backfill de custo, chip «KPIs de valor por sessão») | `{dia, frente, metrics, fonte}` ou lista; upsert por `(dia, frente, fonte)` substituindo `metrics`. |

| Leitura | Quem | O que devolve |
|---|---|---|
| `GET /api/painel/gates?estado=&projeto=&desde=` | painel; regência a cada tick (com `estado=respondido&desde=<último tick>`) | abertos primeiro (urgentes no topo, depois `ts_aberto` desc); respondidos/expirados por `ts_resposta` desc. `estado` calculado: aberto com `ts_expira` no passado sai como `expirado`. |
| `GET /api/painel/serie?conta=&dias=` | aba Contas | linhas ordenadas por `ts` com `pct_semana`/`pct_fable`/`pct_sessao` já extraídos + `ultimas` (última leitura por conta, com fonte) |
| `GET /api/painel/kpi?dias=&frente=` | aba KPIs | linhas de `painel_kpi` fundidas por dia e frente + contagem de gates abertos/respondidos calculada de `painel_gates` (fonte `painel_gates`) |
| `GET /api/painel/resumo` | cabeçalho | abertos, urgentes, respondidos hoje, expirados; estado atual das duas contas |

Mapa código→frente vive no router (`sb`→SuperBot, `lex`→LexBuild, `donna`→Donna, `mc`→Márcio, `gf`→GuyFolkz,
`casa`→Cérebro, `ag`→LexBuild, `hmc`→HMC); código desconhecido passa como está. É o mesmo nome que
`painel-tokens.js` dá às frentes, para custo e gates caírem na mesma linha.

### 2c. A página `/painel` (mobile primeiro; só recharts e Tailwind, que já existem)

- **Gates**: abertos primeiro, urgentes no topo; cada cartão mostra o porquê, o contexto, as opções com a
  consequência escrita e a recomendação; responde-se inline (botão da opção + nota); filtro por projeto;
  histórico dos respondidos/expirados em baixo. Poll a cada 30 s.
- **Contas**: as duas contas ao longo do tempo (% semana e % sessão por leitura), gráfico de linhas, última
  leitura com fonte e idade, alarme visual a partir de 80% (a política da casa: Eduardo pára, Diego entra em
  economia).
- **KPIs**: por frente e por dia: custo (US$ eq.), respostas, sessões, gates abertos→respondidos→executados,
  entregas provadas, retrabalho, cliente-sem-resposta. O que nenhum coletor mediu aparece como «não medido».

### 2d. Importação e histórico (o que se consegue medir com fonte)

- 125 gates do HTML da Mesa + 18 do registo `gates` + 138 `decisoes`: cada decisão vira `respondido` com o
  `ts` do clique; decisão sem gate correspondente cria o gate mínimo (título e projeto vêm da própria decisão).
  Nenhuma resposta se perde. `ts_aberto` dos gates do registo = `updatedAt` quando `version=1`; dos do HTML =
  nulo (não medido).
- Série das contas: logs do tick (`~/.claude/painel-tokens.tick.log` no PC e no jarbas), `usage-real.json`,
  doc `telemetria/tokens` da Mesa e linhas do placar com hora explícita. A % que vem do log do tick é o
  primeiro limite impresso, cujo tipo o log não diz: entra rotulada como `desconhecido`, não como «semana».
- Custo por dia e frente: reconstruído dos transcripts (`~/.claude/projects/*/*.jsonl` e `/srv/corpus` no
  jarbas) com o preço, o dedupe por `message.id` e o `frenteDe` do `painel-tokens.js`.

## 3. Onde o modelo entra

Em lado nenhum. Tudo o que o painel mostra é contado por código a partir de dado com fonte e hora. O
julgamento (esta entrega é o que foi pedido? este VERIFIED é execução?) é a v2 do briefing
`kpi-valor-sessoes.md` do cérebro, que escreve em `painel_kpi` pelo mesmo `POST` quando existir.

## 4. Fora da v1 (explícito)

Expiração automática por prazo (só quem abre o gate declara `ts_expira`) · notificação push · edição de gates
na UI · valor em R$ por cliente · migração da Mesa (a regência migra quando o painel estiver no ar; a Mesa não
se republica nesta frente) · multiusuário (o Bearer é um só) · KPIs de julgamento (v2 do chip).

## 5. Gate de si mesmo

*Construiria isto igual se o modelo não existisse?* Sim: é um painel de dados com três tabelas e uma página.
*Alguma peça depende do modelo acertar sem conferência?* Não. *Quem pode partir isto?* Um coletor a escrever
com `fonte` errada polui a série sem duplicar; por isso cada linha leva a fonte e o painel mostra-a.
