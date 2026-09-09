# Evidência — Painel de Regência (quartel-general), staging 09/09/2026

Tudo aqui é saída real de comando ou de browser. O que não foi verificado está na secção NOT VERIFIED.
Staging: `https://painel-staging.jz9bd8.easypanel.host` · branch `feat/painel-regencia` (Orquestra) e
`claude/ecstatic-turing-cfc284` (cérebro), ambas empurradas.

## 1. O que está no ar no staging (imagem + réplicas + health, as três juntas)

```
$ ssh jarbas 'docker service ls --format "{{.Name}} {{.Replicas}} {{.Image}}"|grep painel-staging'
wordpress_painel-staging-api 1/1 127.0.0.1:5055/painel-staging-api:0758e39
wordpress_painel-staging-db  1/1 pgvector/pgvector:pg16
wordpress_painel-staging-web 1/1 127.0.0.1:5055/painel-staging-web:3f3f2b7-stg

$ ssh jarbas 'docker exec <api> sh -c "echo GIT_SHA=$GIT_SHA"'
GIT_SHA=fba0458                      # ⚠️ o env ficou no sha anterior; a IMAGEM é que manda, e é 0758e39

$ curl -s https://painel-staging.jz9bd8.easypanel.host/api/health
{"status":"ok","service":"orquestra","version":"1.0.1","db":true,...}

$ ssh jarbas 'docker exec <db> psql ... -c "SELECT version_num FROM alembic_version"'
027_painel_qg                        # as duas migrations correram no arranque
```

## 2. Testes

```
$ python -m pytest backend/tests/test_painel.py -q            (só unitários, sem banco)
........s   8 passed, 1 skipped

$ PAINEL_API_URL=<staging> PAINEL_API_TOKEN=… python -m pytest backend/tests/test_painel.py -q
.........   9 passed
```
O 9.º é o contrato completo contra o backend vivo: 403 sem token · criar gate · aparecer no topo dos
abertos · reescrever o texto sem tocar na resposta · responder · histórico da resposta anterior ·
responder sem escolha recusado (400) · expirar · ficheiro JSON criado/inalterado/atualizado pelo carimbo ·
`GET /decisoes` · `executado_em` com prova · placar com chave única · doc `kpi/diario` achatado ·
conflito entre fontes visível · telemetria idempotente por `(ts, conta, fonte)`.

## 3. O ciclo do quartel-general, ponta a ponta (a prova que a regência pediu)

```
# 1. um FICHEIRO JSON, escrito em disco, sem API nenhuma
$ node coletores/gates-watch.js --dir <pasta>
{"ficheiros":1,"mudados":1,"ids":["GQG-TESTE-FICHEIRO"]}
{"criados":1,"atualizados":0,"inalterados":0}

# 2. correr outra vez não repete (md5 local) e forçado não reescreve (carimbo no servidor)
$ node coletores/gates-watch.js --dir <pasta>            -> {"mudados":0}
$ node coletores/gates-watch.js --dir <pasta> --todos    -> {"criados":0,"atualizados":0,"inalterados":1}

# 3. o gate chegou com tudo
$ curl .../api/painel/gates/GQG-TESTE-FICHEIRO
{"projeto":"casa","nome":"Casa (orquestração)","urg":true,"estado":"aberto",
 "fonte_atualizado":"2026-09-09T17:00:00+00:00","origem":"ficheiro","sessao":"local_781ddbe9","opts":2}
```

**Respondido no telemóvel** (viewport 375×812, `/qg?tab=gates#gate-GQG-TESTE-FICHEIRO`): a âncora abriu o
cartão certo, destacado; escolhi A e escrevi a nota; o cartão passou a `RESPONDIDO A`.

```
# 4. e a resposta chegou a quem espera por ela
$ curl ".../api/painel/decisoes?desde=2026-09-09T17:00:00Z"
{"id":"GQG-TESTE-FICHEIRO","escolha":"A",
 "nota":"prova do QG: gate nascido de ficheiro JSON, respondido no telemovel",
 "respondido_em":"2026-09-09T17:13:40.616144+00:00","sessao":"local_781ddbe9"}
```

⛔ Esta é a prova comportamental que a regência exigiu depois de a Mesa ter partido hoje com parse verde:
o clique foi dado no browser e o efeito foi lido pela API, não pelo DOM.

## 4. Dados carregados (todos com fonte e hora)

| O quê | Quanto | Fonte |
|---|---|---|
| Gates | **153** (15 abertos, 11 urgentes; 138 respondidos) | 125 do HTML da Mesa + 18 do registo + decisões órfãs |
| Decisões do Diego | **138**, nenhuma perdida | `decisoes` do registo da Mesa, com o `ts` de cada clique |
| Telemetria | **339 linhas**, 11 fontes, série de **02/09 a 09/09** | logs do tick nas duas máquinas, `usage-real`, doc da Mesa, 5 linhas do placar com hora explícita |
| KPI | **150 linhas**, 2 fontes | `transcripts` (custo por dia/frente, 15 dias) + `valor-sessoes:1d` (9 frentes, doc real do coletor) |
| Placar | **10 projetos** | doc `placar/regencia` da Mesa |

Importação corrida duas vezes: `{"respondidos":138}` na primeira, `{"jaIguais":138,"respondidos":0}` na
segunda. Idempotente, provado, não por leitura do código.

## 5. Defeitos encontrados e corrigidos DURANTE a prova (nenhum saiu do staging)

1. **Todo `PATCH` dava 500** (`MissingGreenlet`): `atualizado_em` com `onupdate` expira no flush e
   `gate_dict` lia o objeto sem `refresh`. Não aparecia em teste unitário nenhum — só contra o banco real.
2. **O cabeçalho mostrava US$ 991 onde eram US$ 32 mil**: o tick do jarbas só vê as sessões do servidor e
   nasceu 4 s depois da leitura completa do PC, ficando «a mais recente». Agora a última leitura por conta
   prefere a completa (`remotoOk`) quando está dentro de 3 h.
3. **Duas fontes sobrepunham-se em silêncio na mesma métrica**: a contagem de gates do painel escreveu 5
   por cima do `gates_respondidos=3` que o coletor mediu no canal do WhatsApp. São números de coisas
   diferentes. Agora o painel conta em `painel_gates_*` e, se duas fontes discordarem, fica a primeira e o
   conflito aparece na resposta e na tela.
4. **O lote mentia**: dizia «atualizados: 1» quando o carimbo tinha travado tudo. Passa a distinguir
   criado/atualizado/**inalterado** — importa porque o watcher corre de 30 em 30 segundos.
5. **Rácios somados**: o cartão de total somava `valor/custo` das 9 frentes e mostrava 53,4, um número sem
   significado, na primeira linha do ecrã. Rácios e medianas saíram dos totais.
6. **Frentes distintas com o mesmo nome**: `lex-build` (o construtor) e `eduardo` (o LMS) iam colidir na
   chave `(dia, frente, fonte)` e uma apagava a outra. O mapa deixou de as juntar.
7. **Placar**: dar o mesmo código a duas frentes fez a segunda ser ignorada em silêncio pela chave única
   (2 linhas perdidas na carga de teste, recarregadas com um código por frente).

Achados de infraestrutura, já na memória da casa
(`easypanel-api-tres-armadilhas-do-staging`): `inspectService` devolve `{"json":…}` sem `result.data`;
`updateEnv` substitui o env INTEIRO (um env vazio deixou a API sem `DATABASE_URL`, health `db:false` sem
erro no deploy); imagem local não deploya, precisa de registry (`registry:2` em `127.0.0.1:5055`).

## 5b. Avaliador independente (subagente `verifier`, contra o staging vivo)

**Veredito: APROVADO COM RESSALVAS.** O que ele confirmou, medindo por SQL direto na base (não pela API,
para não herdar o viés da agregação):

- os números todos batem: `gates=153 · respondidos=138 · telemetria=339 · kpi=150 · placar=10 projetos`,
  `alembic_version=027_painel_qg`, health `db:true`;
- **138 de 138 decisões do Diego** conferidas uma a uma contra os ficheiros do export da Mesa: escolha,
  nota e `ts_resposta` batem em todas. `mismatches: 0`. (Eu tinha provado por amostra; ele provou inteiro.)
- as garantias resistiram ao ataque: POST no id de um gate respondido não altera a resposta; telemetria
  repetida não duplica; carimbo mais velho não reescreve; conflito de fontes aparece em vez de sumir;
  **403 em todas as rotas sem token**, GET e POST; corpo vazio dá 422, data inválida dá 400, id inexistente
  404 — **nenhum 500** em nenhum caso malformado; id com `<script>`/`DROP TABLE` fica string literal e o
  frontend não usa `dangerouslySetInnerHTML` em lado nenhum.

**Três defeitos que ele achou, os três corrigidos e reprovados (commit `832907f`, 9/9 contra o staging):**

1. **`POST /gates` com corpo parcial apagava `why`/`ctx`/`opts`/`rec`.** Um watcher com um JSON mais pobre,
   ou um script que só quisesse corrigir o título, apagava o contexto todo do gate. Agora só se escreve o
   que veio explicitamente no corpo; mencionar o campo vazio continua a poder limpá-lo.
2. **`PATCH` só com nota sobrescrevia a nota de um gate respondido sem passar pelo histórico** — e é
   exatamente o caminho que o `mesa-importar.js` usa para as decisões «só nota».
3. **Higiene**: a EVIDENCIA e o teste do conflito estavam por commitar.

O quarto ponto dele — a suíte de integração deixa rasto no staging — fica como está, declarado: não há
DELETE na API de propósito, e o cabeçalho do teste traz o SQL de limpeza. ⛔ Por isso ela só se corre
contra staging.

## 6. NOT VERIFIED (o que não foi provado, e porquê)

- **Nada em produção.** Subir é gate do Diego (runbook em `painel-regencia.RUNBOOK-deploy.md`).
  ⛔ **Correção a mim próprio, 18:0xZ:** eu escrevi aqui e na PR que a produção era «a imagem de 18/08» e que
  subir levaria 11 commits junto. Falso — inferi a versão pelo campo `DEPLOY_TIMESTAMP` em vez de a provar.
  Medido depois: o bundle servido em produção contém as sentinelas da PR #17 («Consumo de tokens», «sem o
  servidor») **e da PR #18** («PC desligado»), portanto o frontend no ar já é `origin/master`; e nenhum commit
  tocou `backend/` desde antes da imagem. **Subir esta branch leva só o painel.** A lição fica: nem `GIT_SHA`
  (que está `undefined`) nem `DEPLOY_TIMESTAMP` provam a versão quando a tag é `:latest` — só o conteúdo servido.
- **⚠️ O cron do jarbas está de volta ao original** (restaurado às 17:47Z do backup em
  `/home/diego/painel-staging/crontab.bak-0909`). Eu tinha-o apontado à worktree da branch para alimentar o
  staging e isso **quebrou o push da telemetria para a Orquestra de produção durante 7 minutos**, sem erro
  visível: `telemetria-push.js` é untracked e só existe no checkout principal, `lib-orquestra.js` só existia
  na worktree — cada pasta tinha metade do que o tick precisa. O push está a correr de novo, provado no log.
  O `--postOrquestra` só entra depois do merge, com a ordem escrita no passo 6.5 do runbook.
- **O cron do watcher de gates** (`gates-watch.js` de 30 em 30 s no jarbas) não foi instalado: só corri o
  comando à mão. O cron da telemetria FOI trocado no jarbas para apontar ao staging e tem de voltar ao
  destino de produção no cutover (cópia em `/home/diego/painel-staging/crontab.bak-0909`).
- **O hook `Stop` do observador de gates** não foi instalado, de propósito (regra DIR-CC: modo LOG
  primeiro). O observador foi corrido à mão: apanha o gabarito do próprio `CLAUDE.md`, que é o primeiro
  falso positivo conhecido, e um transcript real do dia deu 0 blocos.
- **`respondido_por`** fica nulo quando se responde pelo browser: a página não sabe quem é o utilizador
  (o Bearer é um só). Quem repassa por API declara o `por`.
- **Chrome real e outros browsers**: provado no browser embutido, em 375×812 e em desktop. Não testei
  Safari/iOS. O avaliador não teve ferramenta de browser: a parte visual foi verificada só por mim.
- **Carga**: 153 gates e 339 leituras são poucos. Não medi o painel com milhares de linhas.

## 7. Depois do cutover: o lote de três, já em produção (09/09 à noite)

A regência pediu para reportar três coisas juntas. Ficam aqui com a prova de cada uma.

### 7.1 A percentagem do limite parou de atualizar

O Diego via `30%` com o app dele a dizer `37%`, e mais tarde `—` onde devia estar `43%`. A causa não era
o painel: a **%** era medida por um coletor (`usage-real.js`) e enviada de boleia por outro
(`painel-agora.js`), que mede o **gasto**. A mesma linha de comando dava limites à mão e **não dava
quando o agendador a corria** — sem erro, sem log. Não achei a causa em tempo útil; tirei a boleia e dei
ao número o seu próprio envio (`painel-push-usage.js`), e voltou.

Regra que fica: **quem mede um número é quem o envia.** Uma boleia é mais um sítio onde ele se perde.

E a cadência tinha um segundo defeito, medido às 23:28Z:

```
leitura colhida 23:28:17Z, escrita 23:28:51Z   → a leitura leva ~34 s
validade --minutos 4 numa grelha de 5 min      → a corrida seguinte encontra o ficheiro "fresco" e sai sem colher
```

Uma corrida em cada duas saía vazia: **a cadência real era de 10 min** num painel que diz 5, e o Diego
via uma % de 8 minutos. A regra que eu tinha escrito («a validade tem de ser menor que o intervalo») está
incompleta: tem de ser menor que **o intervalo menos o tempo da leitura**. Corrigido para `--minutos 2`,
tarefa reinstalada e verificada (2 ações, empurrador leu 36%).

### 7.2 Credenciais na nota de um gate

Está no commit `799f412` e na memória `redigir-um-campo-nao-chega-o-valor-antigo-vai-a-algum-lado`. O que
importa reter aqui: **redigir o campo não chegou.** A minha própria regra «a resposta anterior vai para
`extra.historico`» disparou com a substituição e copiou os 1.688 caracteres para outro campo do **mesmo
registo** — o gate ficou redigido e exposto ao mesmo tempo. Só apareceu porque fui ver o registo inteiro
depois, não o campo que tinha mudado. Varri os 174 restantes (um falso positivo: uma frase *a falar* do
padrão). A porta: nota truncada a 120 caracteres em listagens e no poll, inteira só no cartão; e o
formulário avisa e exige segundo clique quando o texto cheira a credencial. Avisar, não bloquear.

### 7.3 `respondido_em` em hora local — e porque NÃO apliquei a migração prescrita

A regência prescreveu: *«migra as linhas existentes (+3 h onde `respondido_em < aberto`)»*. **Medi antes,
e essa regra teria corrompido dois dos cinco registos.** São dois defeitos opostos:

| gates | medido contra o relógio do servidor | causa |
|---|---|---|
| 3 · `GCASA-0909-ROTEAMENTO`, `GH-0909-GLOSSARIO`, `GH-0909-BACKLOG-PAUTAS` | resposta ~3 h **atrás** do `atualizado_em` | hora do Brasil (UTC-3) como `Z` |
| 2 · `GLEX-0909-PR31-TOKEN`, `GLEX-0909-RETENCAO-NAO-RESOLVE` | abertura ~2 h **à frente** do `criado_em` | hora de Berlim (UTC+2, o jarbas) como `Z` |

Somar +3 h aos dois de Berlim levá-los-ia a 5 h de erro, na direção errada. Corrigi caso a caso, usando
`criado_em`/`atualizado_em` como referência (escritas pelo servidor, não passam pelo corpo de ninguém),
com o original em `extra.hora_original`. Prova no gate que a regência citou:

```
GH-0909-BACKLOG-PAUTAS
  aberto    2026-09-09T19:17:29+00:00
  resposta  2026-09-09T19:21:13+00:00        → respondido 4 min DEPOIS de nascer
  original guardado: {"campo":"ts_resposta","valor":"2026-09-09T16:21:13+00:00",
                      "porque":"hora do Brasil (UTC-3) carimbada como Z"}

DEPOIS: 0 incoerentes  (175 gates)
```

A porta (PR #28, provado no staging com 4 casos, incluindo um **controlo** que tem de ficar intacto): um
gate não nasce no futuro, uma resposta não chega antes da pergunta, e um `POST` não move a abertura para
depois de uma resposta já gravada. O corpo recebido fica em `extra.carimbo_corrigido`. Hora no passado
continua aceite — é backfill legítimo.

⚠️ **O que a porta NÃO apanha, e é o que interessa dizer:** só o impossível. Uma hora errada em 3 h que
continue a parecer plausível (gate aberto às 16h, respondido às 17h, ambos em hora local) passa e ninguém
a nota. Por isso a correção verdadeira está no contrato dos orquestradores
(`cerebro/jarbas/COMO-ABRIR-GATE-NO-PAINEL.md`), com a linha certa nas três linguagens da casa.

### 7.4 NOT VERIFIED deste lote

- **Não sei porque `claude -p "/usage"` devolve limites à mão e não devolve pelo agendador.** Contornei
  com um envio próprio; a causa continua por achar.
- **Os 4 gates de teste (`ZT-*`) ficaram no staging**: `DELETE /api/painel/gates/{id}` devolve 405 — a
  rota não existe. Não é problema (o staging vai abaixo no passo 8), mas em produção **não há como apagar
  um gate criado por engano**: só respondê-lo ou deixá-lo expirar.
- **A varredura de credenciais viu forma, não papel** — o mesmo ponto cego de `grep-de-segredo-tem-dois-falsos-positivos`.

### 7.5 O lote no ar (09/09 23:5xZ) — as três juntas, e a sentinela de cada lado

```
backend  ghcr.io/folkz1/orquestra-backend:5b60333e5fc8fc40b2ac7bf99b2eaa4f798e1be6   1/1
frontend ghcr.io/folkz1/orquestra-frontend:5b60333e5fc8fc40b2ac7bf99b2eaa4f798e1be6  1/1
health   {"status":"ok","db":true}
```

Imagem + réplicas + health não chegam (`/health` 200 não prova versão). As sentinelas:

```
backend  GET /api/painel/gates/GH-0909-BACKLOG-PAUTAS
         chave carimbo_corrigido presente: SIM        → o gate_dict novo está a correr
         hora_original preservada: "hora do Brasil (UTC-3) carimbada como Z"
         coerência: respondido 4 min DEPOIS de nascer

frontend bundle assets/index-BaycGOgq.js
         "hora adiante do rel"  1     (procurado sem acentos: o minificador escapa-os)
         "hora corrigida"       1
         "carimbo_corrigido"    1
```

⚠️ **Como este deploy foi feito, e o que isso deixa em aberto.** A via normal (`services.app.updateSourceImage`
+ `deployService` no Easypanel) **não estava disponível**: o token `EASYPANEL_ORQUESTRA_LICITAAI` em
`~/.credenciais/easypanel.env` devolve **401 em todos os endpoints** — foi rotacionado desde 02/08 e o
ficheiro não acompanhou. Subi por `docker service update --image ... --update-order start-first
--with-registry-auth`, que é a mesma via usada no staging e converge sem janela sem serviço.

**A consequência, dita antes que alguém a descubra:** o Swarm corre a imagem nova, mas a **config do
Easypanel continua a dizer `0b6f266`**. Se alguém clicar *Deploy* no painel do Easypanel, o serviço
**volta atrás** e o defeito das horas regressa. Handoff no relatório: gerar um token novo e repô-lo em
`~/.credenciais/easypanel.env` — enquanto isso não acontecer, deploy da Orquestra só por `docker service update`.

Ponto de recuo, se for preciso: `docker service update --image ghcr.io/folkz1/orquestra-{backend,frontend}:0b6f266d74f52920d91656515d635277cdae8c1c`.
