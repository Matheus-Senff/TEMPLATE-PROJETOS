# Instruções para o Claude neste projeto

Região: Vercel `gru1` (`vercel.json` nos dois apps), Neon `aws-sa-east-1` e Upstash em São Paulo.

Monorepo npm workspaces: `apps/api` (Hono + Drizzle/Neon + Clerk + R2 + Zod + Turnstile + Upstash Redis; opcionais: Stripe, Ably, Resend, Sentry, QStash, PostHog) e `apps/web` (Next.js 16 + Clerk + Tailwind 4 + Sentry + PostHog). Deploy: Vercel (dois projetos, root `apps/web` e `apps/api`). O web chama a API pelo proxy `/api` na mesma origem (`API_URL`, rewrite no `next.config.ts`).

## Ambientes e banco (não negociável)

- Local usa a branch `dev` do Neon (`DATABASE_URL` do `.env`); preview usa uma branch por preview (integração Neon ↔ Vercel); produção (branch `main`) só é tocada pelo deploy. Nunca rode migração, SQL de escrita ou restauração contra produção a partir da máquina local.
- Mudou o schema: `npm run db:generate` e commite a migração em `apps/api/drizzle` (nunca edite journal/snapshot à mão; migração de dados: `npx drizzle-kit generate --custom`). Aplicar localmente: `npm run db:migrate` (vai para a `dev`). Não existe `db:push`.
- Produção migra no build da API (`vercel-build` → `dist/scripts/migrate.js`), antes de o código novo entrar no ar; se falhar, o deploy falha. Por isso toda migração é **expand/contract**: o código anterior tem de funcionar com o banco novo (coluna nova nullable/com default; remover ou renomear só numa entrega seguinte).
- Timestamps sempre com `timestampMs()` (milissegundos; o teste de schema falha sem isso) e FKs para `users.id` com `onDelete: "cascade", onUpdate: "cascade"`.

## Regras de código

- Trabalho demorado ou que pode falhar (e-mail, PDF, integrações): vire um job em `jobs.service.ts` e chame `enqueue()` (com `await`); não bloqueie a requisição.
- Rotas sensíveis a abuso (login, upload, envio de e-mail, checkout): aplique `rateLimit({...})`. Formulário público: Turnstile (`verifyTurnstile(token, clientIp(c), "acao")` na API + `<Turnstile action="acao" />` no web).
- Validação de entrada: use `validate()` (`src/middlewares/validate.ts`) em vez de `zValidator`; erros saem como `{ error, issues }` em português (zod com locale pt-BR).
- Toda consulta a dado de usuário filtra pelo dono (`ownerId`/`orgId`) no servidor; nunca confie em ids do body. Outro usuário recebe 404, não 403.
- `requireAuth` já garante a linha em `users` (`ensureUser`). Em jobs/webhooks que gravam algo ligado a um usuário que talvez nunca tenha usado a API, chame `ensureUser(id)` antes.
- Ação irreversível (excluir conta/dados, trocar papel, mover dinheiro): `requireReverification()` na rota + `useReverification(fn)` com `unwrapReverifiable()` no web, e diálogo de confirmação antes.
- Recurso pago: `requirePlan()` (ou `hasActiveSubscription(billingOwner(c))`); o estado vem da tabela `subscriptions`, nunca da página de sucesso nem de chamada ao Stripe por requisição.
- Uploads: só tipos de `UPLOAD_ALLOWED_TYPES`, tamanho assinado, cota `UPLOAD_QUOTA_BYTES`, fluxo presign → PUT → `confirm`; Stripe: preços restritos por `STRIPE_PRICE_IDS` e webhooks via `processStripeEvent` (idempotente).
- SDK opcional novo: carregue sob demanda com `lazy()` (`src/config/lazy.ts`) e só com a chave definida; nunca `import` de SDK pesado no topo de arquivo da API (cold start).
- Mensagens de erro e textos para o usuário em português; comentários de código em inglês.

- Antes de entregar qualquer mudança: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` na raiz (e `npm run format` se o editor não formatou).
- Toda regra de negócio nova ganha teste em `apps/api/test` (offline; módulos via `vi.stubEnv` + `vi.resetModules`). Regras que tocam o banco: Postgres real com `createTestDb()` (`test/helpers/pglite.ts`; PGlite local, Postgres de verdade no CI). Rotas autenticadas: `appWith(path, rotas, { userId, orgId, reverified })` de `test/helpers/auth.ts`.
- Eventos de produto importantes: `trackEvent()` na API (mesmo id do Clerk que o PostHog do navegador).
- Nova funcionalidade: módulo em `apps/api/src/modules/<feature>/` com `<feature>.routes.ts`, `<feature>.service.ts` e `<feature>.schemas.ts` (só zod; compartilhado com o web via `@app/api/schemas/<feature>`). Monte em `src/app.ts` com `.route()` encadeado (mantém o `AppType`). Exemplo completo: `modules/contact`. `routes/` e `services/` ficam para a plataforma (auth, uploads, billing, notificações, cron).
- Web: dados via TanStack Query (`useQuery`/`useMutation`/`useInfiniteQuery` + `useApi()` + `unwrap()`, chaves em `lib/query-keys.ts`); formulários com `react-hook-form` + `zodResolver(schemaCompartilhado)`; componentes de `components/ui` (Button, Input, Textarea, Select, Field, Dialog, Table, Badge, Skeleton, EmptyState). Exemplos: `contact-form.tsx`, `files-list.tsx`. Não crie route handlers do Next em `/api` (é o proxy da API).
- Várias escritas que precisam acontecer juntas: `transaction(async (tx) => ...)` de `src/db/index.ts` (sem chamadas externas dentro). Leituras e escritas simples: `db`.
- Multi-tenant (SaaS com várias empresas, desligado por padrão): `tenantColumns()` na tabela, `requireOrgRole()` na rota e toda consulta por `tenantScope(c)` (`where`/`values`, `src/lib/tenant.ts`); `test/tenant.test.ts` falha, por instrução, se uma consulta a tabela com `orgId` não usar `<scope>.where(tabela)`, se um insert não usar `.values(<scope>.values(...))` ou se um update fizer `.set({ orgId })`. Limites da checagem (revise à mão): joins numa tabela do tenant, `sql` cru e instruções quebradas por `;` dentro de callbacks. B2B: dê a cada usuário uma organização pessoal no cadastro, para todo dado nascer com `org_id`; cobrança por organização = `BILLING_OWNER=org`.
- Páginas públicas ficam estáticas: nada de `auth()`/`currentUser()`/`headers()` em layout ou página pública; dados de usuário em componentes cliente. Páginas privadas chamam `await auth.protect()` e entram no `createRouteMatcher` do `proxy.ts`.
- Navegador falando com host novo (script, API, imagem, iframe, upload): adicione em `apps/web/csp.ts` (CSP gerada no build, sem nonce, para manter páginas estáticas).
- Tempo real: um só cliente Ably via `RealtimeProvider`; use `useRealtimeEvent(evento, handler)`.
- Variáveis novas: valide em `apps/api/src/config/env.ts` e documente nos `.env.example`. Nunca commite `.env`.
- Módulos opcionais respondem 503 ou viram no-op quando a chave está vazia; não remova esse comportamento. Rate limit (Upstash) e Turnstile são obrigatórios em produção, salvo `RATE_LIMIT_DISABLED`/`TURNSTILE_DISABLED` explícitos.
- Segredos (Ably key, Stripe secret, R2, Clerk secret, CRON_SECRET) só na API ou em código de servidor do Next; nunca em `NEXT_PUBLIC_*`.
- Idioma: o produto é só pt-BR, sem framework de i18n (decisão consciente: menos código e páginas estáticas mais simples). Se um dia precisar de outro idioma, adote `next-intl` com rotas `app/[locale]` e mova os textos para `messages/pt-BR.json`.

## Módulos prontos (use antes de criar algo novo)

- Notificações: `notify(userId, {...})` na API (sininho + tempo real) e `useToast()` no web. Toda ação do usuário tem retorno visível.
- Auditoria: `audit({...})`. Paginação: `paginationQuery` + `toPage()` + `decodeCursor()` (cursor inválido = 400). Papéis: `requireRole("admin")` (Clerk `publicMetadata.role`; session token com `{ "metadata": "{{user.public_metadata}}" }`).
- Reverificação: `requireReverification()` (API) + `useReverification()`/`unwrapReverifiable()` (web), em uso em `DELETE /me` e na troca de papel.
- Administração: `/admin` (usuários do Clerk, busca, paginação, troca de papel auditada) em `apps/api/src/modules/admin` e `apps/web/components/admin-users.tsx`.
- Arquivos: `POST /uploads/presign` (cota por usuário) → PUT no R2 → `POST /uploads/:id/confirm` (HeadObject, `pending` → `ready`); listagem só de prontos; `DELETE /uploads/:id` pelo dono; pendentes velhos limpos pela retenção (`upload.service.ts`, `upload-card.tsx`, `files-list.tsx`).
- Pagamentos (Stripe): tabelas `billing_customers` e `subscriptions` sincronizadas pelos webhooks (`syncSubscription`), dono por `billingOwner(c)` (`BILLING_OWNER=user|org`), `getEntitlement()`/`hasActiveSubscription()`/`requirePlan()`, planos em `src/config/plans.ts`, páginas `/billing`, `/billing/success` (sincroniza pela `session_id`) e `/billing/cancel`, bloqueio de assinatura duplicada.
- Feature flags: `isFeatureEnabled(flag, userId)` na API (PostHog ou `FEATURE_FLAGS`), `GET /me/flags` e `useFeatureFlag(flag)` no web (`NEXT_PUBLIC_FEATURE_FLAGS` para visitantes).
- Rotinas agendadas: Vercel Cron em `apps/api/vercel.json` chamando `routes/cron.ts` com `Authorization: Bearer CRON_SECRET` (retenção diária, funciona sem QStash).
- Saúde: `GET /health` (status + banco; detalhes com `Bearer CRON_SECRET`) e `GET /health/live` (sem banco, para monitores).
- Redirecionamentos e links vindos de dados: `isSafePath()` (`lib/redirect.ts` na API e no web).
- Movimento: `Reveal`, `useReducedMotion` e tokens (`apps/web/lib/motion.ts`); `prefers-reduced-motion` global no `globals.css`. Scroll animado, parallax, 3D e transições: agente `motion` + skill `motion-kit`.
- LGPD: `GET /me/export` (inclui arquivos, notificações, cobrança e atividade), `DELETE /me` (Clerk, Stripe, R2 em lotes, banco), webhook do Clerk (`/webhooks/clerk`), banner de cookies (PostHog só com consentimento), retenção (IP de auditoria apagado após 180 dias), `/privacidade` e `/termos` (dados em `apps/web/lib/site.ts`).
- SEO: `metadata` com template de título, `sitemap.ts`, `robots.ts`, imagem Open Graph, ícone e manifest, `NEXT_PUBLIC_SITE_URL`.
- Qualidade: `npm run lint`, `npm run format`, `npm run test:e2e` (Playwright em `apps/web/e2e`: público sempre; logado em `e2e/auth` com `@clerk/testing` contra o preview).
- Sair do Clerk (se um dia precisar): todas as FKs para `users.id` têm `ON UPDATE CASCADE`; migre os usuários para o novo provedor, gere o mapa id antigo → novo e rode `UPDATE users SET id = <novo> WHERE id = <antigo>` (primeiro numa branch do Neon); depois troque `middlewares/auth.ts` e o web (detalhes no agente `infra`).

## Checklist de entrega (o que a IA costuma esquecer)

Antes de dar uma tela ou funcionalidade por pronta, confira e implemente o que se aplica:

- Estados de tela: carregando, vazio (com próximo passo), erro (com ação), sucesso.
- Feedback: toast em toda ação, confirmação antes de excluir, botão desabilitado durante envio.
- Notificações: eventos importantes chamam `notify()` (sininho) e, se crítico, e-mail via job.
- Painel administrativo: quem gerencia usuários, conteúdo, pedidos e configurações (`requireRole("admin")`).
- Listas: busca, filtros, ordenação, paginação por cursor e exportação CSV quando útil.
- Formulários: validação no cliente e no servidor (zod), máscaras (CPF, telefone, CEP), mensagens claras; públicos com Turnstile.
- Responsivo (mobile primeiro), dark mode, acessibilidade (labels, foco, contraste, teclado).
- SEO e conteúdo: `metadata` por página, Open Graph, nenhum texto provisório.
- Segurança: dono do dado filtrado no servidor, `rateLimit` em rotas de abuso, `audit()` em ações sensíveis, reverificação em ações irreversíveis, host novo na CSP.
- LGPD: dados novos entram na exportação e na exclusão (`exportUserData`/`deleteUserData`) e, se for dado pessoal, na retenção.
- Testes: regra nova com teste na API; fluxo crítico com E2E.
- Operação: variáveis novas no `env.ts` e nos `.env.example`, migração gerada, expand/contract e commitada.

## Agentes e comandos (`.claude/`)

| Agente | Papel |
|---|---|
| `arquiteto` | Briefing vira plano de MVP, regras e backlog (não escreve código) |
| `backend` | API: rotas, tabelas, migrações, jobs, regras com teste |
| `frontend` | Telas, componentes, formulários, layout, acessibilidade |
| `motion` | Animação, scroll storytelling, 3D/WebGL com 60 fps (skill `motion-kit`) |
| `autenticacao` | Clerk: login social, MFA, reverificação, papéis, organizações, convites, sessão |
| `conteudo` | Textos reais, landing pages, microtextos, SEO on-page, blog |
| `pagamentos` | Planos, assinaturas, Pix/boleto, webhooks, acesso por plano |
| `automacao` | Chatbots, IA, WhatsApp/Telegram, fluxos automáticos, handoff humano |
| `qa` | Testes E2E e de integração, critérios de aceite |
| `infra` | Vercel, Neon (branches, migrações, backup), R2, Clerk, Sentry, CI, domínios |
| `seguranca` | Auditoria de segurança e LGPD (só leitura) |
| `desempenho` | Auditoria de desempenho (só leitura) |
| `debug` | Causa raiz, correção mínima e teste |

- Revisão de código: `/code-review` (nativo). Comandos: `/configurar-projeto <nome>`, `/planejar <briefing>`, `/nova-funcionalidade <descrição>`, `/seo`, `/atualizar-deps`, `/auditoria-seguranca`, `/auditoria-desempenho`, `/auditoria-completa`, `/debug <erro>`, `/pre-deploy`.
- Projeto começa por `/planejar`; cada funcionalidade por `/nova-funcionalidade`. Rode `/pre-deploy` antes de publicar e `/auditoria-seguranca` ao fechar cada etapa grande.
