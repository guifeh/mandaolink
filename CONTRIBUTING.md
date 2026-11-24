# Como contribuir

## Fluxo
1. Crie a branch a partir da `develop`, com o nome `feat/<task>-<descricao>` ou `fix/<task>-<descricao>`. Exemplo: `feat/s3-conector-telegram`.
   - Na pasta compartilhada (`Shared/mandaolink`), **não troque de branch**, porque isso muda os arquivos de todos. Use uma worktree:
     `git worktree add ..\mandaolink-s3 -b feat/s3-conector-telegram origin/develop`
2. Abra o PR para a `develop` preenchendo o template: o quê, por quê, como testar e a task do backlog.
3. O CI precisa estar verde: typecheck, lint, format, testes (Postgres real + PGlite), build, audit e `docker compose config`.
4. Revisão e merge pelo **Tech Lead**, sempre com **squash**.
5. Release: PR `develop → main`, aberto e mesclado pelo Tech Lead. Push na `main` gera a imagem Docker como artefato do CI. **Não há deploy automático.**

## Antes de abrir o PR
```bash
npm ci
npm run typecheck
npm run lint          # 0 erros; avisos no-unsafe-* são backlog conhecido
npm run format:check  # ou npm run format
npm test              # TEST_DATABASE_URL opcional, para rodar as migrações num Postgres real
npm run build
```

## Regras
- Nunca commitar `.env`, auth state do WhatsApp, perfis do Playwright, dumps ou segredos. O `.gitignore` cobre esses casos; na dúvida, pergunte.
- Formatação vai em commit separado da lógica.
- Nada de conectar número, criar conta, enviar mensagem ou publicar sem aprovação do Guilherme passada pelo Tech Lead.
