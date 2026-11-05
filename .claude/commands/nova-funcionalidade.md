---
description: Implementa uma funcionalidade de ponta a ponta com os agentes (plano, back, front, testes, segurança)
argument-hint: "<descrição da funcionalidade>"
---

Funcionalidade: $ARGUMENTS

1. `arquiteto`: plano curto (telas, tabelas, rotas, regras, critérios de aceite). Mostre e espere aprovação se houver mudança de schema, de permissões ou de escopo relevante; caso contrário, siga.
2. `backend`: schema, migração, rotas, serviços, jobs e testes das regras.
3. `frontend`: telas e componentes consumindo a API via `useApi()` + `unwrap()`, com estados de carregando, vazio e erro. Animações, scroll e 3D ficam com o `motion`; textos com o `conteudo`; cobrança com o `pagamentos`.
4. Notificações: confira se cada evento relevante do plano chama `notify()` e se toda ação na tela tem toast de retorno. Bots, chat e WhatsApp ficam com o `automacao`.
5. `qa`: testes dos critérios de aceite (API e E2E dos fluxos críticos).
6. `seguranca`: auditoria apenas dos arquivos alterados; corrija achados Críticos e Altos.
7. Confira o "Checklist de entrega" do `CLAUDE.md` item a item.
8. Rode `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` na raiz e entregue: o que foi feito, arquivos alterados, como testar e pendências.
