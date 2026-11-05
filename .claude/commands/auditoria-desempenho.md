---
description: Auditoria de desempenho (consultas, índices, cache, jobs, bundle e renderização do Next.js)
argument-hint: "[rota ou tela lenta opcional]"
---

Use o agente `desempenho` para analisar o escopo "$ARGUMENTS" (se vazio, o projeto inteiro: apps/api e apps/web).

Depois do relatório, liste as 3 ações de maior impacto por esforço e pergunte se devo aplicá-las. Ao aplicar, meça antes e depois quando possível e rode `npm run typecheck`, `npm test` e `npm run build`.
