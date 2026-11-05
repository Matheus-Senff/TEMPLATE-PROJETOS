---
description: Atualiza dependências com segurança (Dependabot, npm outdated, breaking changes, testes)
---

1. Liste `npm outdated` na raiz e os PRs abertos do Dependabot.
2. Rode `npm audit --omit=dev` e priorize vulnerabilidades High e Critical.
3. Atualize patch e minor em lote; majors uma por vez, lendo o changelog e listando breaking changes que afetam o código.
4. Depois de cada lote: `npm ls --all` (tem de sair sem erro; o `overrides.esbuild` da raiz e o `ajv` de desenvolvimento do web existem só para isso: revise-os quando drizzle-kit ou @hookform/resolvers mudarem), `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` (e `npm run test:e2e`). Se algo quebrar, use o agente `debug`.
5. GitHub Actions ficam fixadas por SHA com a tag no comentário (`uses: dono/acao@<sha> # vX.Y.Z`); ao atualizar, pegue o SHA com `git ls-remote https://github.com/<dono>/<acao> refs/tags/<tag>` (em tag anotada, use o `^{}`).
6. Entregue tabela: Pacote | De | Para | Tipo | Impacto | Status.
