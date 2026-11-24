# P3 — evidências de implementação e validação

Data: 23/11/2026. Estado: implementação pronta para revisão; aceite Docker pendente.

## Resultado

- Monorepo inicializado com Git; workspaces `apps/*`, `packages/*` e diretórios solicitados.
- Migração `db/migrations/001_initial.sql`: sete tabelas de negócio, duas de autenticação, chaves/índices, imutabilidade dos logs e transições de envio.
- `apps/api/src/app.ts`: config, histórico, pendências, pausa, saúde e link mágico de um usuário.
- `apps/api/src/migrate.ts`: runner transacional/versionado com lock por sessão.
- `apps/api/src/server.ts`, `db.ts`: bootstrap e conexão PostgreSQL.
- `apps/api/test/api.test.ts`: 13 testes de migração/SQL/API.
- `apps/api/README.md`: execução, contratos HTTP, autenticação e limites.

## Verificação executada

Ambiente host: Windows; Node padrão v26.13.0. Build e suíte foram executados explicitamente com Node v24.22.3 via pacote `node@24`.

```powershell
npx --yes --package=node@24 node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
npx --yes --package=node@24 node --import tsx --test apps/api/test/api.test.ts
npm audit --omit=dev
git diff --check
docker compose config --quiet
```

Resultado: compilação com código 0; 13 testes passaram, 0 falharam; auditoria de dependências de execução sem vulnerabilidades conhecidas; Compose passou na validação estática. O repositório ainda não tem commit, portanto `git diff --check` não examina os arquivos novos não rastreados.

SQL executado em PostgreSQL embutido PGlite, do zero e reaplicado sem duplicar. Testes exercitaram constraints, triggers, FKs, persistência e consultas reais da API. O adapter de teste ignora apenas advisory lock; não comprova concorrência entre processos nem transporte TCP.

## Pendente e limites

- Docker CLI está disponível, mas o engine `desktop-linux` não respondeu (pipe inexistente). `docker desktop start` não iniciou o engine; a tentativa CLI foi encerrada. Não foi possível executar `docker compose up`, migração em Postgres de container ou build da imagem. Esse aceite segue pendente para J4/TL com Docker operacional.
- Revisão solicitada ao Dev Senior, ainda pendente no momento deste registro.
- Transporte de e-mail é stub autorizado: a API não entrega links nem expõe tokens; login interativo depende da integração de e-mail e da PWA. O fluxo de autenticação foi verificado por callback em memória.
- Nenhuma conta criada, nenhum número conectado, nenhuma mensagem enviada, nenhuma publicação/deploy. Nenhum commit ou push feito.
- Arquivos locais de dependências (`node_modules`), lockfile e compilação (`apps/api/dist`) foram produzidos. Testes embutidos usam somente dados sintéticos em memória.
