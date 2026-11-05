---
description: Roda segurança e desempenho em paralelo e consolida um plano de correção priorizado
argument-hint: "[escopo opcional]"
---

Escopo: "$ARGUMENTS" (se vazio, o projeto inteiro).

1. Rode em paralelo os agentes `seguranca` e `desempenho` sobre o escopo.
2. Consolide em uma única tabela: Prioridade (P0 a P3), Área (Segurança/Desempenho), Arquivo:linha, Problema, Correção, Esforço. P0 = explorável ou que derruba produção.
3. Liste o que ficou fora do escopo ou não pôde ser verificado.
4. Pergunte quais itens aplicar. Ao aplicar, delegue para `backend` ou `frontend`, com testes, e rode `npm run typecheck`, `npm test` e `npm run build`.
