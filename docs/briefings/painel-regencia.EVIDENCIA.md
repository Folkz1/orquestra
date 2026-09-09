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

## 6. NOT VERIFIED (o que não foi provado, e porquê)

- **Nada em produção.** A Orquestra em produção continua com a imagem de 18/08; subir é gate do Diego
  (runbook em `painel-regencia.RUNBOOK-deploy.md`).
- **O cron do watcher de gates** (`gates-watch.js` de 30 em 30 s no jarbas) não foi instalado: só corri o
  comando à mão. O cron da telemetria FOI trocado no jarbas para apontar ao staging e tem de voltar ao
  destino de produção no cutover (cópia em `/home/diego/painel-staging/crontab.bak-0909`).
- **O hook `Stop` do observador de gates** não foi instalado, de propósito (regra DIR-CC: modo LOG
  primeiro). O observador foi corrido à mão: apanha o gabarito do próprio `CLAUDE.md`, que é o primeiro
  falso positivo conhecido, e um transcript real do dia deu 0 blocos.
- **`respondido_por`** fica nulo quando se responde pelo browser: a página não sabe quem é o utilizador
  (o Bearer é um só). Quem repassa por API declara o `por`.
- **Chrome real e outros browsers**: provado no browser embutido, em 375×812 e em desktop. Não testei
  Safari/iOS.
- **Carga**: 153 gates e 339 leituras são poucos. Não medi o painel com milhares de linhas.
