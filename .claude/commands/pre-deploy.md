---
description: Checklist antes de publicar em produção (verificações, segurança, migrações, ambientes e variáveis)
---

Antes de publicar:

1. Rode na raiz `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `npm audit --omit=dev --audit-level=high`. Pare se algo falhar.
2. Rode `npm run db:generate` e confirme que não surgiu migração nova não commitada (o job `db` do CI também barra isso).
3. Migrações novas: confira que são expand/contract (a versão antiga continua funcionando com o banco novo: nada de remover/renomear coluna usada no mesmo deploy) e que rodaram no preview (branch do Neon do preview). Em produção elas rodam no build da API; se falharem, o deploy não sobe.
4. Use o agente `seguranca` só nos arquivos alterados desde o último deploy (`git diff --name-only origin/main...HEAD`).
5. Confira nos `.env.example` se toda variável nova está documentada e cadastrada na Vercel nos ambientes certos (Production com chaves de produção; Preview com Clerk de desenvolvimento e banco de preview, nunca o de produção) e no GitHub quando usada pelos workflows.
6. Produção: `CORS_ORIGINS`/`APP_URL` com a URL real do front, `API_URL` do web apontando para a API, Upstash Redis (ou `RATE_LIMIT_DISABLED` consciente), Turnstile (ou `TURNSTILE_DISABLED` consciente), `CRON_SECRET`, `PRODUCTION_DATABASE_HOST`, `STRIPE_PRICE_IDS` se houver Stripe, `API_PUBLIC_URL` se houver QStash, `CLERK_JWT_KEY` recomendado.
7. Depois do deploy: `GET /health` responde `ok`, login, uma ação principal e o E2E logado do preview verde.
8. Entregue um resumo: pronto ou bloqueado, e o motivo.
