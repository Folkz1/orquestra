# Runbook — subir o Painel de Regência à produção da Orquestra

> Skill da casa: `deploy`. A prova de deploy é a IMAGEM NO AR (digest/sha) + réplicas 1/1 + health,
> nunca o branch nem o `/health 200` sozinho. **Subir à produção é GATE do Diego.** Este runbook prepara e pára.

## 0. O que está no ar (medido 09/09/2026 16:0xZ, no jarbas)

| Serviço | Imagem no ar | Criada | Nota |
|---|---|---|---|
| `wordpress_orquestra-backend` | `ghcr.io/folkz1/orquestra-backend@sha256:7a0c04863c05…` | 2026-08-18T23:08Z (`DEPLOY_TIMESTAMP` 2026-08-18T22:38Z) | `GIT_SHA=undefined` no env: a imagem não diz de que commit veio |
| `wordpress_orquestra-frontend` | `ghcr.io/folkz1/orquestra-frontend:latest` | — | `GIT_SHA=undefined` |
| `wordpress_orquestra-db` | `pgvector/pgvector:pg16` | — | base de produção |

⛔ **CORREÇÃO à primeira versão deste runbook (medida 09/09 18:0xZ).** Eu tinha escrito que subir levaria
«11 commits de master que não estão no ar desde 18/08». **É falso, e o erro foi inferir a versão pela data do
campo `DEPLOY_TIMESTAMP` em vez de a provar no mundo.** O que se mede:

- `GIT_SHA` é `undefined` nos dois serviços e `DEPLOY_TIMESTAMP` do frontend diz `2026-08-18T23:10Z` — mas o
  bundle servido em `https://guyyfolkz.mbest.site` contém código de commits de **08/09**. A tag `:latest` foi
  reescrita pelo CI e o Swarm puxou-a num restart, sem ninguém tocar no painel do Easypanel. **Nenhum campo do
  serviço prova a versão; só o conteúdo servido prova.**
- Sentinelas no bundle de produção (strings que só existem a partir de cada PR): «Consumo de tokens» e «sem o
  servidor» (PR #17) → presentes; «PC desligado» (PR #18, commit `809277e`) → **presente**. Logo o frontend no
  ar já é `origin/master` (`59d7e24`).
- `git log origin/master -- backend/` desde a imagem: **nenhum commit**. O último a tocar o backend é `84afd81`,
  de 18/08. O backend de master é o mesmo que está no ar.

**Portanto: subir esta branch leva SÓ o painel.** `git merge-base --is-ancestor origin/master HEAD` confirma que
master é ancestral (não regride nada), e o diff da branch contra master são 13 ficheiros, todos do painel
(+2543/−1), sem tocar em Recorder, Kanban ou gravações.

Como o CI funciona (`.github/workflows/docker.yml`): `on: push: branches: [master]` constrói e publica
`ghcr.io/folkz1/orquestra-{backend,frontend,ai-agent}:latest` **e** `:<sha>`. Não faz deploy: o Easypanel só puxa
quando alguém chama `deployService` (ou o webhook). Logo **merge em master ≠ deploy**, mas muda o `:latest` que o
próximo deploy de qualquer pessoa vai puxar.

## 1. O gate (o que o Diego decide)

```
⛔ GATE — subir o Painel de Regência (feat/painel-regencia → master → produção da Orquestra)
Por que é seu   · deploy em produção (e só isso: medido, leva apenas o painel — ver secção 0)
Já feito e provado · staging em https://painel-staging.jz9bd8.easypanel.host (API 832907f, web 3f3f2b7-stg,
                     1/1, health db:true, alembic 027); 9/9 no contrato contra o staging vivo; 153 gates +
                     138 decisões (avaliador conferiu 138/138: escolha, nota e hora batem); 339 leituras de
                     telemetria, série de 02/09 a 09/09; 150 linhas de KPI de 2 fontes; placar de 10 frentes;
                     gate nascido de FICHEIRO JSON, respondido no telemóvel e lido em /api/painel/decisoes;
                     avaliador independente: aprovado com ressalvas, 3 defeitos achados e corrigidos
Opções          · A) subir agora (merge + deploy dos dois serviços com tag :<sha>, prova, importar os dados)
                  B) subir só o backend primeiro (a API do painel fica de pé; a página vem a seguir)
                  C) ficar em staging mais um dia e olhar a série a encher
Recomendação    · A com tag :<sha> fixada (nunca :latest), de dia, com os passos 3–6; rollback é um comando
```

## 2. Antes de tocar: prova do ar

```bash
ssh jarbas 'docker service inspect wordpress_orquestra-backend --format "{{.Spec.TaskTemplate.ContainerSpec.Image}}"; \
  docker service ls --format "{{.Name}} {{.Replicas}}" | grep orquestra'
curl -s https://orquestra-backend.jz9bd8.easypanel.host/api/health
```
Guardar a saída: é o ponto de recuo.

## 3. Merge e CI

```bash
gh pr merge <PR feat/painel-regencia> --merge      # só com o «vai» do Diego
gh run watch                                        # docker.yml: 3 imagens
SHA=$(git rev-parse origin/master)                  # o sha do merge
```
Confirmar que `ghcr.io/folkz1/orquestra-backend:$SHA` e `orquestra-frontend:$SHA` existem (`gh api` ou `docker manifest inspect`).

## 4. Deploy no Easypanel (projeto `wordpress`), tag fixada

⚠️ `updateSourceImage` sem `username`/`password` APAGA a credencial do GHCR (skill `easypanel`, pegadinha 1).
Ler antes com `inspectService` (a resposta é `{"json": {...}}`, sem `result.data`) e reenviar a credencial junto.
⚠️ `updateEnv` substitui o env INTEIRO: nunca mandar env parcial nem vazio (em 09/09 um env vazio deixou a API
de staging sem `DATABASE_URL`). Para trocar uma variável, ler o env com `inspectService`, editar, reenviar tudo.

```
POST services.app.updateSourceImage  {"json":{"projectName":"wordpress","serviceName":"orquestra-backend",
      "image":"ghcr.io/folkz1/orquestra-backend:<SHA>","username":"<o que o inspect devolveu>","password":"<idem>"}}
POST services.app.deployService      {"json":{"projectName":"wordpress","serviceName":"orquestra-backend"}}
(o mesmo para orquestra-frontend)
```
O Alembic corre no arranque do backend (`lifespan` em `main.py`): a migration `026_painel_regencia` cria as três
tabelas. Não há passo manual de migration.

## 5. Prova depois (as três juntas)

```bash
ssh jarbas 'docker service inspect wordpress_orquestra-backend --format "{{.Spec.TaskTemplate.ContainerSpec.Image}}"'   # == :<SHA>
ssh jarbas 'docker service ls --format "{{.Name}} {{.Replicas}}" | grep orquestra'                                       # 1/1
ssh jarbas 'docker service logs --tail 50 wordpress_orquestra-backend 2>&1 | grep -i "alembic"'                          # "migrations OK" e 026
curl -s https://orquestra-backend.jz9bd8.easypanel.host/api/health                                                       # db:true
curl -s -H "Authorization: Bearer $APP_SECRET_KEY" https://orquestra-backend.jz9bd8.easypanel.host/api/painel/resumo     # 200, tudo a zero
```
Abrir `https://guyyfolkz.mbest.site/painel` no telemóvel: cabeçalho, três abas, «Nada à sua espera».

## 6. Dados e coletores (cutover da Mesa)

1. **Export fresco da Mesa** (só uma sessão Claude consegue): `read_db` das coleções `gates` e `decisoes` para
   `D:/projetos/cerebro/relatorios/mesa-export-<dia>/`, HTML da Mesa mais recente extraído com
   `relatorios/mesa-export-0909/extrair-html.js <html> <dir>/gates-html.json`, e `gates-meta.json` com
   `{id: {version, updatedAt}}` dos docs do registo (sai do `read_db list` sem `out_dir`).
2. `node coletores/mesa-importar.js --dir <dir> --dry` e depois sem `--dry` (destino = produção por defeito; o token
   sai de `D:/projetos/orquestra/.env`). Idempotente: correr duas vezes não duplica nem reescreve respostas.
3. `node coletores/painel-backfill.js --telemetria` e `--custo --desde 2026-08-26` (o custo lê o jarbas por ssh, ~5 min).
4. **Cérebro no jarbas**: fundir `claude/ecstatic-turing-cfc284` em `master` e fazer `pull` em `/srv/projetos/cerebro`.
   ⚠️ Lá `coletores/telemetria-tick.js`, `telemetria-push.js` e `usage-real.js` existem como ficheiros NÃO rastreados
   (e no PC do Diego, no checkout `eval/taxa-de-finalizacao`): mover de lado antes do pull
   (`mv coletores/telemetria-tick.js coletores/telemetria-tick.js.pre-merge`), senão o pull recusa.
   ⚠️ Outro chip está a consertar o `telemetria-tick.js` («servia 92% de cache de ontem»): fundir os dois, a
   alteração daqui é aditiva (bloco `--postOrquestra`).
5. **Cron do jarbas** (utilizador `diego`). ⛔ **ARMADILHA MEDIDA em 09/09, não repetir**: eu apontei o cron
   à worktree da branch para alimentar o staging e **quebrei o push da telemetria para a Orquestra de
   produção durante 7 minutos**, sem erro visível em lado nenhum. A causa: `telemetria-push.js` é um
   ficheiro **não rastreado** que só existe em `/srv/projetos/cerebro/coletores/`, e `lib-orquestra.js`
   (novo) só existia na worktree. Cada pasta tinha metade do que o tick precisa. Já reverti — o cron está
   no original e o push voltou a correr (prova no log: «[push] não escrevi: perderia DeA-PC, jarbas:diego,
   jarbas:claude2», que é a guarda dele a funcionar).

   **A ordem certa, depois do merge:** (a) fundir a branch do cérebro em `master` e fazer `pull` em
   `/srv/projetos/cerebro`; (b) **confirmar que a MESMA pasta tem os três**: `telemetria-tick.js` (com o
   bloco `--postOrquestra`), `telemetria-push.js` e `lib-orquestra.js`; (c) só então acrescentar
   `--postOrquestra` à linha que já existe:
   `*/10 * * * * /usr/bin/node /srv/projetos/cerebro/coletores/telemetria-tick.js --aqui --minutos 8 --postOrquestra >> /srv/projetos/cerebro/coletores/telemetria-cron.log 2>&1`
   (sem `. ~/.orquestra-painel.env;` — produção é o destino por defeito e o token sai de `/srv/projetos/orquestra/.env`).
   Depois apagar `/home/diego/.orquestra-painel.env` e a worktree `/srv/projetos/cerebro/.claude/worktrees/painel-regencia`.
   ⚠️ O primeiro tick a seguir a um redeploy pode dar 404 se apanhar o container a arrancar (aconteceu às
   17:40:04Z, 10 s antes de o novo estar pronto). Não é defeito: o tick tenta outra vez em 10 min e a
   linha é única por `(ts, conta, fonte)`.
6. **Hook do PC do Diego** (`~/.claude/settings.json`, comando `node D:/projetos/cerebro/coletores/telemetria-tick.js`):
   acrescentar `--postOrquestra` para a leitura mais completa (as duas contas com limites, via `--remoto`) chegar também.
7. A regência deixa de escrever gates na Mesa: `POST /api/painel/gates` (contrato no briefing) e lê respostas com
   `GET /api/painel/gates?estado=respondido&desde=<último tick>`.

## 6b. Quartel-general: a porta de ficheiro (depois do passo 6)

1. **Pasta dos gates no jarbas**: `mkdir -p /srv/projetos/hub-deus/gates` (versionada no git do hub-deus).
   Quem abre um gate escreve `<id>.json` lá (formato no briefing, secção A1.1) e não precisa de mais nada.
2. **Cron do watcher** (utilizador `diego`, a cada 30 s — o cron mínimo é 1 min, por isso duas linhas):
   ```
   * * * * * /usr/bin/node /srv/projetos/cerebro/coletores/gates-watch.js >> /srv/projetos/cerebro/coletores/gates-watch.log 2>&1
   * * * * * sleep 30; /usr/bin/node /srv/projetos/cerebro/coletores/gates-watch.js >> /srv/projetos/cerebro/coletores/gates-watch.log 2>&1
   ```
3. **KPIs**: `valor-sessoes.js --dias 1` uma vez por dia (é ele que faz nascer a série diária), seguido de
   `painel-push-kpi.js`. Um `--dias 7` continua a valer e entra marcado como `valor-sessoes:7d`.
4. **Observador de gates**: correr `gate-observador.js --transcript <ficheiro>` à mão sobre um dia de
   trabalho e ler `despachante/_gates.jsonl` ANTES de sequer falar em instalar hook. ⛔ Ele apanha o
   gabarito do próprio `CLAUDE.md` (é o formato exato) — esse é o primeiro falso positivo conhecido, e é
   por isso que o modo observação existe.
5. **A regência** passa a escrever gates em ficheiro (ou por API) e a ler respostas em
   `GET /api/painel/decisoes?desde=<último tick>`; ao executar, confirma com
   `PATCH /api/painel/gates/<id>` mandando `executado_em` e `executado_prova`.
6. **Cada orquestrador** faz `POST /api/painel/placar` ao fechar ciclo. ⛔ Um código de projeto por frente
   distinta: a chave é `(projeto, medido_em)`, e dar o mesmo código a duas frentes faz a segunda ser
   silenciosamente ignorada (aconteceu na carga de teste, 2 linhas perdidas até se corrigir).
7. **O link que vai ao WhatsApp** é `https://guyyfolkz.mbest.site/qg#gate-<id>` — abre o cartão certo no
   telemóvel. ⛔ Nunca com token na URL.

## 7. Rollback

```
POST services.app.updateSourceImage  {"json":{..."image":"ghcr.io/folkz1/orquestra-backend@sha256:7a0c04863c055ddbb73f2d5e5fb935447d6b2b1e65cf8a3458752ee2f107e1f0", + credencial}}
POST services.app.deployService
```
As tabelas `painel_*` podem ficar (nada as lê). Se for preciso: `alembic downgrade 025_add_testing_tables`.

## 8. Desmontar o staging (depois do cutover)

`services.app.destroyService` para `painel-staging-api` e `painel-staging-web`; `services.postgres.destroyService`
para `painel-staging-db`; no jarbas `docker rm -f painel-registry` e `docker rmi` das imagens `painel-staging-*` e
`127.0.0.1:5055/painel-staging-*` (⚠️ nunca `prune -a`); apagar `/home/diego/painel-staging`.
