# Template Projeto

Esqueleto full stack em pt-BR para começar sites e sistemas novos já com login, banco, upload de arquivos, pagamentos, notificações, LGPD, testes, CI/CD e deploy na Vercel. Vem com agentes, comandos e skills do Claude Code para planejar e construir em cima dele seguindo os mesmos padrões.

## Stack

| Camada | Tecnologia | Onde | Status |
|---|---|---|---|
| Front-end | Next.js 16 + Tailwind 4 | `apps/web` | obrigatório |
| API | Hono (Node) | `apps/api` | obrigatório |
| Banco | Neon (Postgres) + Drizzle | `apps/api/src/db` | obrigatório |
| Login e papéis | Clerk | web + api | obrigatório |
| Arquivos | Cloudflare R2 + AWS SDK v3 | `storage.service.ts`, `upload.service.ts` | obrigatório |
| Anti-robô | Cloudflare Turnstile | `turnstile.service.ts`, `components/turnstile.tsx` | obrigatório em produção (ou `TURNSTILE_DISABLED=true`) |
| Limite de requisições e cache | Upstash Redis | `middlewares/rate-limit.ts`, `cache.service.ts` | obrigatório em produção (ou `RATE_LIMIT_DISABLED=true`) |
| Pagamentos | Stripe | `billing.service.ts`, `/billing` | opcional (`STRIPE_SECRET_KEY`) |
| Tempo real | Ably | `realtime.service.ts`, `realtime-provider.tsx` | opcional (`ABLY_API_KEY`) |
| E-mail | Resend | `email.service.ts` | opcional (`RESEND_API_KEY`; sem ela, só registra no log) |
| Erros | Sentry | `apps/api/src/instrument.ts`, `apps/web/instrumentation*.ts` | opcional (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`) |
| Tarefas em segundo plano | Upstash QStash | `jobs.service.ts`, `routes/jobs.ts` | opcional (sem ele, as tarefas rodam na hora) |
| Rotinas agendadas | Vercel Cron | `apps/api/vercel.json`, `routes/cron.ts` | `CRON_SECRET` |
| Analytics e feature flags | PostHog | `trackEvent()`, `isFeatureEnabled()` / `useFeatureFlag()` | opcional (`POSTHOG_KEY`; flags caem para `FEATURE_FLAGS`) |
| Testes | Vitest (PGlite e Postgres real) + Playwright | `apps/api/test`, `apps/web/e2e` | `npm test`, `npm run test:e2e` |
| CI/CD | GitHub Actions + Vercel | `.github/workflows` | automático |

Módulos opcionais com a chave vazia ficam desligados sem quebrar nada (a rota responde 503 ou o recurso vira no-op). Os SDKs só são carregados quando a chave existe e no primeiro uso, para manter o cold start da API baixo.

## O que vem pronto

| Recurso | Onde |
|---|---|
| Login, papéis (`admin`), reverificação em ações irreversíveis | Clerk, `middlewares/auth.ts`, `requireRole()`, `requireReverification()` |
| Painel administrativo (usuários, busca, troca de papel auditada) | `/admin`, `apps/api/src/modules/admin` |
| Upload direto para o R2 com cota por usuário | `POST /uploads/presign` → PUT → `POST /uploads/:id/confirm` |
| Assinaturas e pagamentos avulsos (por usuário ou organização) | `billing.service.ts`, `requirePlan()`, `/billing` |
| Notificações (sininho, toast, tempo real) | `notify()`, `useToast()` |
| Registro de auditoria | `audit()`, tabela `audit_logs` |
| LGPD: exportação, exclusão de conta, retenção, banner de cookies, páginas legais | `/me/export`, `DELETE /me`, `retention.service.ts`, `/privacidade`, `/termos` |
| Formulário de contato público com Turnstile (exemplo de módulo) | `apps/api/src/modules/contact`, `components/contact-form.tsx` |
| Módulos por funcionalidade com schemas zod compartilhados com o front | `apps/api/src/modules/<feature>`, `@app/api/schemas/<feature>` |
| Cliente da API tipado no front (`hono/client` + `AppType`) | `apps/web/lib/api.ts` |
| Multi-tenant (desligado por padrão) | `tenantColumns()`, `requireOrgRole()`, `tenantScope(c)` |
| Transações, paginação por cursor, cache | `transaction()`, `paginationQuery`/`toPage()`, `cached()` |
| Feature flags | `isFeatureEnabled()` (API), `useFeatureFlag()` (web) |
| Kit de componentes e formulários | `components/ui`, `react-hook-form` + zod |
| Movimento e 3D | `apps/web/components/motion`, skill `motion-kit` |
| SEO técnico | `metadata`, `sitemap.ts`, `robots.ts`, Open Graph, manifest |
| Segurança | CSP gerada no build (`csp.ts`), rate limit, redirecionamento seguro, webhooks idempotentes |
| Backup diário e teste semanal de restauração | `.github/workflows/backup.yml`, `restore-drill.yml` |

## Como usar

### 1. Criar o projeto

- **Pelo GitHub:** "Use this template" neste repositório, clone o repositório novo e, no Claude Code, rode `/configurar-projeto <nome> <objetivo em uma frase>`.
- **Pelo Claude Code (`/novo-projeto`):** copie `.claude/skills/novo-projeto` para `~/.claude/skills/novo-projeto` e defina uma vez o `TEMPLATE_REPO` no topo do `SKILL.md` (`<seu-usuario>/Template-Projetos`; se ficar o placeholder, a skill pergunta). Depois peça "novo projeto <nome>": a skill cria o repositório a partir do template e configura banco, variáveis e deploy.

### 2. Configurar

1. Identidade: `name` no `package.json` da raiz, `apps/web/lib/site.ts` (nome, descrição e os dados entre colchetes usados nas páginas legais) e o título deste README.
2. Neon: crie o projeto (a branch `main` é a produção) e uma branch `dev` para uso local.
3. Copie os `.env.example` e preencha (referência abaixo):
   ```bash
   cp apps/api/.env.example apps/api/.env   # Neon (branch dev), Clerk (desenvolvimento), R2 e opcionais
   cp apps/web/.env.example apps/web/.env   # Clerk e API_URL
   ```
4. Configure os serviços (seção [Configuração dos serviços](#configuração-dos-serviços)).

### 3. Rodar localmente

```bash
npm install
npm run db:migrate   # aplica as migrações na branch dev do Neon
npm run dev          # api :3000 + web :5173 (o navegador chama /api, repassado à API)
npm test             # testes offline, sem chaves reais
```

Confira `http://localhost:3000/health` e `http://localhost:5173`. Antes de entregar qualquer mudança: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

### 4. Publicar

Veja [Deploy na Vercel](#deploy-na-vercel). Depois do primeiro deploy, defina o primeiro admin no Clerk (`publicMetadata` `{ "role": "admin" }`) e comece pelo `/planejar <briefing>`.

## Ambientes

| Ambiente | Web | API | Banco (Neon) | Clerk | Migrações |
|---|---|---|---|---|---|
| Local | `localhost:5173` | `localhost:3000` | branch `dev` | instância de desenvolvimento | `npm run db:migrate` (manual) |
| Preview (cada PR) | URL de preview | preview da mesma branch (`API_URL` com `{branch}`) | branch do preview (integração Neon ↔ Vercel) | instância de desenvolvimento | build do preview, só com `MIGRATE_PREVIEW=true` |
| Produção (`main`) | domínio | domínio da API | branch `main` | instância de produção | build de produção da API |

- A URL do banco de produção nunca vai para o `.env` local nem para o ambiente Preview. Com `PRODUCTION_DATABASE_HOST` definido, um preview ou ambiente local que aponte para produção não sobe.
- Previews aceitam login pelo `AUTHORIZED_PARTY_PATTERN` (regex das URLs de preview do web).
- O web chama a API pelo proxy na mesma origem `/api` (sem CORS), com destino em `API_URL`, lido no build. Na Vercel, sem `API_URL` o build do web falha de propósito. Para outro domínio ou app mobile, use o modo direto: `NEXT_PUBLIC_API_URL` absoluto e a origem em `CORS_ORIGINS`.
- `API_URL` com `{branch}` exige que a Vercel builde a API em toda branch: no projeto da API, desligue "Skip deployments when there are no changes to the root directory" (Settings → Git / "Skip unaffected projects") e não use Ignored Build Step que pule a branch. Se preferir manter o skip, aponte o `API_URL` do Preview para uma API de staging fixa (ex. o preview da branch `develop`); senão o preview do web responde 404 em `/api`.
- IP do visitante pelo proxy: defina o mesmo `API_PROXY_SECRET` nos dois projetos. O proxy do web repassa o IP assinado e a API só confia nele com o segredo certo (confira uma vez com `LOG_LEVEL=debug`: `source: web-proxy`).
- Mudanças de banco são expand/contract: a migração roda antes de o código novo entrar no ar e a versão em produção continua servindo enquanto isso. Remover ou renomear coluna/tabela é sempre uma segunda entrega.

## Variáveis de ambiente

A referência completa, com onde pegar cada valor, está em `apps/api/.env.example` e `apps/web/.env.example`. Toda variável nova é validada em `apps/api/src/config/env.ts`.

**API (`apps/api`)**

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | URL *pooled* do Neon (local: branch `dev`) |
| `DATABASE_URL_UNPOOLED` | produção | URL direta para a migração no build (a integração Neon ↔ Vercel define) |
| `PRODUCTION_DATABASE_HOST` | recomendado | host da `main` sem `-pooler`; impede preview/local de usar produção |
| `MIGRATE_PREVIEW` | não | `true` no Preview para migrar a branch do preview |
| `APP_URL`, `CORS_ORIGINS` | sim | URL do front (redirects do Stripe, Clerk `authorizedParties`) |
| `AUTHORIZED_PARTY_PATTERN` | previews | regex das URLs de preview do web |
| `API_PROXY_SECRET` | recomendado | mesmo valor do web; IP real do visitante no rate limit |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | sim | Clerk |
| `CLERK_JWT_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | recomendado | verificação sem rede; sincronização de usuários e exclusão LGPD |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | sim | uploads |
| `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_TYPES`, `UPLOAD_QUOTA_BYTES` | não | limites de upload (padrões: 25 MB, lista segura, 1 GiB) |
| `TURNSTILE_SECRET_KEY` (ou `TURNSTILE_DISABLED`) | produção | formulário público |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (ou `RATE_LIMIT_DISABLED`) | produção | rate limit e cache |
| `CRON_SECRET` | produção | Vercel Cron e `/health` detalhado |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_IDS`, `BILLING_OWNER` | opcional | pagamentos |
| `ABLY_API_KEY` | opcional | tempo real |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_EMAIL` | opcional | e-mail |
| `SENTRY_DSN` | opcional | erros |
| `QSTASH_*`, `API_PUBLIC_URL` | opcional | tarefas em segundo plano |
| `POSTHOG_KEY`, `POSTHOG_HOST`, `FEATURE_FLAGS` | opcional | analytics e flags |

**Web (`apps/web`)**

| Variável | Obrigatória | Para quê |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | sim | Clerk |
| `API_URL` | sim | destino do proxy `/api` (por ambiente; Preview com `{branch}`) |
| `API_PROXY_SECRET` | recomendado | mesmo valor da API |
| `NEXT_PUBLIC_SITE_URL` | produção | links canônicos, Open Graph, sitemap |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | produção | widget do Turnstile |
| `R2_UPLOAD_ORIGIN`, `R2_PUBLIC_URL` | recomendado | CSP: só o seu bucket |
| `NEXT_PUBLIC_API_URL` | não | modo direto, sem proxy |
| `NEXT_PUBLIC_STRIPE_PRICE_ID` | opcional | botão de checkout de exemplo |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | opcional | erros e source maps |
| `NEXT_PUBLIC_POSTHOG_*`, `NEXT_PUBLIC_FEATURE_FLAGS` | opcional | analytics (só com consentimento) e flags de visitantes |

**GitHub:** environment `production` com `DATABASE_URL_UNPOOLED` (backup e migração manual) e, para o backup, `R2_ACCOUNT_ID` e `R2_BACKUP_*`; no repositório, os secrets `E2E_CLERK_PUBLISHABLE_KEY`/`E2E_CLERK_SECRET_KEY` (instância de desenvolvimento) e `VERCEL_AUTOMATION_BYPASS_SECRET` para o E2E logado nos previews, e a variável `VERCEL_WEB_PROJECT` (nome do projeto web na Vercel).

## Configuração dos serviços

- **Neon:** projeto com a branch `main` (produção) e a branch `dev` (local). Connection string *pooled* no `DATABASE_URL`. Migrações: `npm run db:generate` (gera a partir do `schema.ts`) e `npm run db:migrate` (só na `dev`). Não existe `db:push`: toda mudança passa por migração versionada. Instale a integração Neon ↔ Vercel no projeto da API para ter uma branch por preview.
- **Clerk:** instância de desenvolvimento (local e previews) e de produção (domínio próprio). Sessions → Customize session token `{ "metadata": "{{user.public_metadata}}" }` (papéis); `CLERK_JWT_KEY` (JWT public key) para verificar sem rede; webhook `<API>/webhooks/clerk` com `user.created`, `user.updated` e `user.deleted` (`CLERK_WEBHOOK_SIGNING_SECRET`); Attack protection ligado. Sem o webhook, a linha do usuário é criada no primeiro acesso à API.
- **Turnstile:** widget na Cloudflare com o domínio (e `vercel.app` para previews); `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no web e `TURNSTILE_SECRET_KEY` na API (`TURNSTILE_ALLOWED_HOSTNAMES` se houver mais de um domínio).
- **Upstash Redis:** rate limit (120 req/min por usuário/IP na API toda, limites próprios em upload, checkout e contato) e `cached(key, ttl, fn)`.
- **R2:** bucket privado, token de API e CORS do bucket permitindo `PUT`/`GET` das origens do front (produção e previews). Defina `R2_UPLOAD_ORIGIN` no web para a CSP aceitar só o seu bucket.
- **Stripe:** produto/preço no painel; `price_...` em `NEXT_PUBLIC_STRIPE_PRICE_ID` (web) e `STRIPE_PRICE_IDS` (API). Webhook `<API>/stripe/webhook` com os eventos listados no `.env.example`. Quem paga: `BILLING_OWNER=user` (padrão) ou `org` (organização do Clerk). Acesso pago: `requirePlan()` na rota. Local: `stripe listen --forward-to localhost:3000/stripe/webhook`.
- **Resend:** verifique o domínio e ajuste `EMAIL_FROM`. Novo e-mail: `emailTemplates` + job.
- **Sentry:** projetos Node (API) e Next.js (web); o SDK só carrega com o DSN. Source maps: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- **QStash:** token, as duas signing keys e `API_PUBLIC_URL`. Novo job: `jobs` + `enqueue()`. A retenção roda pelo Vercel Cron mesmo sem QStash.
- **PostHog:** `NEXT_PUBLIC_POSTHOG_KEY` (web, só com consentimento de cookies) e `POSTHOG_KEY` (API: eventos e feature flags avaliadas no servidor).
- **Ably:** a key fica na API; o navegador recebe um JWT de 1 hora (`user:<userId>`, `public:*`).

## Deploy na Vercel

| Projeto | Root Directory | Build | Observação |
|---|---|---|---|
| `<nome>-web` | `apps/web` | `next build` | variáveis de `apps/web/.env.example`; `API_URL` por ambiente |
| `<nome>-api` | `apps/api` | `npm run vercel-build` (fixado no `vercel.json`) | variáveis de `apps/api/.env.example`; migra o banco antes de publicar |

- Push no `main` publica em produção; cada PR ganha preview (web + API + branch do Neon).
- Integração **Neon ↔ Vercel** no projeto da API: Production aponta para a branch `main`; Preview cria uma branch por deploy. Defina `PRODUCTION_DATABASE_HOST` em todos os ambientes e `MIGRATE_PREVIEW=true` no Preview.
- **Migração no build:** o build de produção da API aplica as migrações com a URL direta (`DATABASE_URL_UNPOOLED`), numa transação e com `pg_advisory_lock` (deploys simultâneos esperam um pelo outro). Se a migração falhar, o deploy falha e a versão atual continua no ar. O job `migrate` do CI é só um fallback manual (Actions → CI/CD → Run workflow). Migração que reescreve tabela grande: publique sozinha, num horário calmo, e teste antes numa branch do Neon.
- Região: `gru1` nos dois `vercel.json` (combine com Neon `aws-sa-east-1`).
- Deployment Protection nos previews: crie "Protection Bypass for Automation" (`VERCEL_AUTOMATION_BYPASS_SECRET`) para o E2E; deixe a proteção desligada no projeto da API (ela já exige token do Clerk) ou proteja só o web.
- Opcional: Vercel → Settings → Git, publique só com os checks do GitHub verdes.

## Backup e restauração

1. **Primeira opção (minutos ou horas atrás):** restauração point-in-time do Neon. Neon → Branches → *Create branch* a partir de um horário anterior ao problema, confira os dados nessa branch e só então use *Restore* na `main` (ou aponte o `DATABASE_URL` de produção para a nova branch).
2. **Backup diário no R2:** `.github/workflows/backup.yml` faz `pg_dump` da produção (URL direta, `DATABASE_URL_UNPOOLED`) para um bucket privado. `.github/workflows/restore-drill.yml` testa toda semana a restauração do dump mais recente num Postgres descartável (tabelas, contagem de linhas e migrações).
3. **Restaurar um dump (nunca direto na produção):**
   ```bash
   # 1. Baixe o dump (credenciais do bucket de backup)
   AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
     aws s3 cp s3://<bucket>/db/backup-<data>.dump backup.dump --endpoint-url https://<account>.r2.cloudflarestorage.com
   # 2. Crie uma branch NOVA no Neon (ex. restore-<data>) e pegue a URL direta dela
   # 3. Restaure nessa branch (--clean troca o conteúdo DESTA branch, não da produção)
   pg_restore --clean --if-exists --no-owner --no-privileges -d "<URL direta da branch restore>" backup.dump
   # 4. Confira: select count(*) from users; select count(*) from drizzle.__drizzle_migrations;
   ```
   Com os dados conferidos, promova a branch (Neon → *Set as default*/*Restore*) ou aponte o `DATABASE_URL` de produção para ela e faça redeploy. Arquivos do R2 não estão no dump (o bucket é a fonte); se precisar, ative versionamento/lifecycle no bucket.

## Estrutura

```
apps/
  api/                       Hono + Drizzle
    src/index.ts             entrada (export default p/ Vercel; servidor Node local)
    src/app.ts               app + AppType (monta todas as rotas)
    src/config/              env (zod), clientes sob demanda (lazy.ts), planos (plans.ts)
    src/db/                  schema e conexão Neon + transaction()
    src/lib/                 paginação, tenantScope, billingOwner, redirect seguro, segredo
    src/middlewares/         clerkAuth, requireAuth, requireRole, requireReverification, requirePlan, rateLimit
    src/modules/             funcionalidades (contact, admin)
    src/routes/              plataforma: uploads, stripe, notifications, me, realtime, jobs, webhooks, cron
    src/services/            regras: storage, uploads, users, billing, flags, retention...
    src/scripts/migrate.ts   migração do build da Vercel (falha o deploy se falhar)
    drizzle/                 migrações SQL versionadas
    test/                    Vitest (PGlite; Postgres real no CI)
  web/                       Next.js (App Router)
    proxy.ts                 Clerk (protege /dashboard, /admin, /billing)
    csp.ts, api-proxy.ts     CSP e proxy /api calculados no build
    app/                     páginas (home, contato, legais, dashboard, admin, billing)
    components/              upload, arquivos, cobrança, notificações, tempo real, Turnstile, ui/
    e2e/                     Playwright (público sempre; logado com @clerk/testing)
.claude/                     agentes, comandos e skills do Claude Code
.github/workflows/           ci.yml, e2e-preview.yml, backup.yml, restore-drill.yml
```

No web, todas as rotas da API ficam em `/api/...` (proxy). Scripts da raiz: `dev`, `dev:api`, `dev:web`, `build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `db:studio`.

## Agentes, comandos e skills do Claude Code

Ficam em `.claude/` e vão junto para cada projeto criado do template. As regras do projeto, os módulos prontos e o papel de cada agente estão no [`CLAUDE.md`](CLAUDE.md).

| Comando | O que faz |
|---|---|
| `/configurar-projeto <nome>` | Configura um projeto criado com "Use this template" |
| `/planejar <briefing>` | Plano de MVP: escopo, telas, dados, rotas, regras e backlog |
| `/nova-funcionalidade <descrição>` | Plano, back, front, testes e segurança de ponta a ponta |
| `/seo [rotas]` | SEO técnico: metadata, OG, sitemap, robots, JSON-LD e desempenho |
| `/atualizar-deps` | Atualiza dependências com testes e lista breaking changes |
| `/auditoria-seguranca [escopo]` | Autorização/IDOR, uploads, webhooks, segredos, headers, dependências, LGPD |
| `/auditoria-desempenho [escopo]` | Consultas, índices, cache, jobs, bundle e renderização |
| `/auditoria-completa [escopo]` | As duas em paralelo, com plano P0 a P3 |
| `/debug <erro>` | Reproduz, acha a causa raiz, corrige e prova com teste |
| `/pre-deploy` | Checklist antes de publicar |

- **Agentes:** `arquiteto`, `backend`, `frontend`, `motion`, `autenticacao`, `conteudo`, `pagamentos`, `automacao`, `qa`, `infra`, `seguranca`, `desempenho`, `debug`.
- **Skills:** `novo-projeto` (cria um projeto a partir deste template; instale em `~/.claude/skills`) e `motion-kit` (scroll animado, parallax, 3D e transições).

## Licença

[MIT](LICENSE)
