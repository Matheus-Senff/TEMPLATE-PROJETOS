---
description: Auditoria de segurança completa (autorização, RLS, uploads, webhooks, segredos, headers, dependências, LGPD)
argument-hint: "[pasta, rota ou arquivo opcional]"
---

Use o agente `seguranca` para auditar o escopo "$ARGUMENTS" (se vazio, o projeto inteiro: apps/api e apps/web).

Depois do relatório:
1. Mostre a tabela de achados por severidade.
2. Para cada achado Crítico ou Alto, proponha a correção concreta (arquivo e trecho).
3. Pergunte se devo aplicar as correções. Se sim, use o agente `backend` ou `frontend` conforme o arquivo, com teste para cada regra nova, e rode `npm run typecheck`, `npm test` e `npm run build`.
