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

---

# Adendo 1 — o painel é o QUARTEL-GENERAL, e a entrada é JSON simples (09/09/2026 ~19:1xZ)

> Diego, literal, pela regência: «não faz sentido criarmos a mesa em um link nosso e um banco de dados
> nosso e colocar hooks tudo para atualizar e varias automações para ela ficar util como nosso quartel
> general e você atualizar gates com json simples?»

Isto muda a hierarquia do desenho: o painel **não é um espelho da Mesa**. O requisito nº 1 passa a ser
**qualquer sessão, hook, cron ou script cria e atualiza um gate escrevendo JSON simples** — sem ferramenta
Artifact, sem sessão Claude no caminho. A API continua a existir; o ficheiro é a porta de quem não fala HTTP.

## A1.1 Entrada por ficheiro (a porta principal)

`/srv/projetos/hub-deus/gates/<id>.json` no git é fonte legítima. Um watcher no jarbas
(`coletores/gates-watch.js`, cron de 30 s) lê a pasta e faz POST do que mudou para `/api/painel/gates/lote`.

O formato é o que a casa já escreve, e o POST aceita os dois vocabulários (o da Mesa e o canónico):

```json
{ "id": "GSB-0910-PORTA", "proj": "sb", "projNome": "SuperBot (Emílio)", "urg": true,
  "titulo": "…", "why": "deploy em produção", "ctx": ["…"],
  "opts": [["A", "abrir já", "o cliente vê [imagem] no lugar do comprovativo"],
           ["B", "fechar as 2 lacunas antes", "duas frentes pequenas; zero incidente"]],
  "rec": "B", "aberto": "2026-09-10T08:12:00Z", "sessao": "local_9e455d31",
  "atualizado": "2026-09-10T08:12:00Z", "prazo": "2026-09-10T20:00:00Z" }
```

`proj`→`projeto`, `projNome`→`projeto_nome`, `aberto`→`ts_aberto`, `prazo`→`ts_expira`, `sessao`→`extra.sessao`.
**Idempotência por `id` + `atualizado`**: o watcher guarda o último `atualizado` que empurrou
(`.gates-watch.estado.json`) e não repete; o servidor, por seu lado, nunca deixa um POST tocar em
`escolha`/`nota`/`estado` de um gate respondido. Ficheiro apagado **não** apaga o gate: fechar é responder.

## A1.2 Hook que apanha «⛔ GATE» na saída das sessões

O `despachante/_gates.jsonl` existe com 0 bytes desde 28/08 porque nunca teve destino. Passa a ter:
`coletores/gate-observador.js` lê o transcript de uma sessão, encontra os blocos no formato da casa
(`⛔ GATE — …` com `Por que é seu`, `Opções`, `Recomendação`) e escreve o JSON.

⛔ **Modo observação primeiro** (regra DIR-CC: hooks no cérebro só em modo LOG). O observador grava em
`despachante/_gates.jsonl` o que **teria** criado, com o id proposto e o texto extraído; ninguém o instala
como hook antes de o Diego ver o que ele apanharia. Instalar o hook `Stop` é passo do runbook, não desta v1.

## A1.3 A resposta sai do painel para quem espera

Um gate só serve se a decisão voltar. `GET /api/painel/decisoes?desde=<ISO>` devolve as respostas dadas
depois daquele instante — a regência e o orq dono do gate fazem poll de 30 s e agem. Cada resposta guarda
`escolha`, `nota`, `respondido_em` e `por` (quem respondeu). Quando o dono executa, confirma com
`PATCH /api/painel/gates/<id>` mandando `executado_em` e `executado_prova` (a prova, em texto: sha no ar,
id da mensagem, link). O painel mostra os três estados do ciclo: **aberto → respondido → executado**, e é
isso que mede o «respondido→executado» dos KPIs sem ninguém procurar em inbox nenhum.

## A1.4 Placar por projeto

Cada orquestrador faz `POST /api/painel/placar` ao fechar ciclo, com
`{projeto, dono, estado, proximo, prazo, gate, medido_em}`. A tabela `painel_placar` guarda **uma linha por
envio** (histórico, como a telemetria), e o painel mostra a última de cada projeto com o histórico por baixo.
É o `_hub-placar.md` a deixar de ser um ficheiro que só cresce.

## A1.5 `/qg`, mobile e âncora por gate

A página responde em `/painel` **e** em `/qg`, e cada cartão tem âncora `#gate-<id>`: o link do WhatsApp da
regência abre o gate certo no telemóvel. Autenticação é a da Orquestra (login uma vez no telemóvel);
⛔ **nunca token na URL** — um link partilhado com token é uma credencial em texto claro num canal de terceiros.

⚠️ A âncora é exatamente onde a Mesa se partiu hoje: um `id` de âncora sobrescreveu o id do cartão e o clique
deixou de gravar durante **uma hora**, com o parse verde. Por isso a prova desta versão é comportamental, não
estrutural: responder um gate no telemóvel **e** ver a linha aparecer em `GET /api/painel/decisoes`.

## A1.6 KPIs: o formato que o coletor já produz

`coletores/valor-sessoes.js` (master do cérebro, commit 2b97c48, ~100 s, zero tokens) escreve
`relatorios/kpi-sessoes.json` — o doc `kpi/diario`. O painel consome esse ficheiro **tal como está**:
`{gerado, janela:{ini,fim,dias}, linhas:[{frente, sessoes, entregas{deploy_provado, entrega_confirmada,
pr_fundida, envio_cliente, relatorio_verified}, gates{abertos_na_janela, respondidos, expirados, pendentes,
mediana_min, mesa_decisoes, mesa_executados_rastreados, mesa_mediana_min}, custo_usd, custo_pct_limite,
valor_custo, retrabalho_pct, cliente_sem_resposta_min, pontos, pronto_declarado}], notas:[]}`.

⚠️ **As linhas do coletor são por frente numa JANELA, não por dia.** Guardá-las como se fossem de um dia
seria inventar. Regra: `dia` = o dia de `janela.fim`, e a `fonte` carrega a janela — `valor-sessoes:1d`,
`valor-sessoes:7d`. Como a chave única é `(dia, frente, fonte)`, um agregado de 7 dias nunca se soma nem se
sobrepõe a um de 1 dia, e o painel mostra a fonte ao lado de cada número. A série diária nasce do coletor a
correr com `--dias 1` todos os dias; o histórico de 7 dias fica como está, marcado.

## A1.7 O que continua fora

Apagar gate pela API (fechar é responder) · edição do texto do gate na UI (quem abre, escreve) · notificação
push · multiutilizador (o `por` é declarado por quem escreve, não autenticado por utilizador).
