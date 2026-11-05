---
name: novo-projeto
description: Cria um projeto novo (site/sistema) a partir do repositório-modelo Template-Projetos no GitHub (Next.js + Hono + Neon + Clerk + R2 + Zod + Vitest; opcionais Ably, Stripe, Resend, Sentry, Upstash Redis/QStash, PostHog), configura banco (branch dev separada da produção), variáveis, deploy na Vercel e primeiro commit. Use quando o usuário disser "novo projeto", "criar projeto", "/novo-projeto" ou pedir um site/sistema novo a partir do esqueleto.
---

# Novo projeto a partir do template

## Configuração (defina uma vez)

```
TEMPLATE_REPO = <seu-usuario>/Template-Projetos
```

`TEMPLATE_REPO` é o repositório-modelo (dono/nome) usado no `gh repo create --template`. Se ainda estiver com `<seu-usuario>`, pergunte ao usuário qual é o repositório (o fork/cópia dele do template), confirme com `gh repo view <dono>/<nome>` que ele existe e está marcado como template, e substitua o valor acima neste arquivo para não perguntar de novo.

Entrada esperada: nome do projeto (slug, ex.: `portal-clientes`), pasta-mãe local (pergunte se ainda não estiver definida e guarde a resposta na memória), módulos opcionais (Stripe, Ably, Resend, Sentry, Upstash Redis, QStash, PostHog: ligado/desligado) e uma frase sobre o objetivo do projeto. Se o nome ou o objetivo faltarem, pergunte antes de começar; os demais têm padrão.

Depois do repositório criado, o passo a passo detalhado é o mesmo do comando `/configurar-projeto` (fonte única: `.claude/commands/configurar-projeto.md`). Esta skill só acrescenta a criação do repositório e o deploy inicial.

## Ambientes (regra que não muda)

| Ambiente | Banco (Neon) | Clerk | Quem migra |
|---|---|---|---|
| Local (`.env`) | branch **`dev`** | instância de desenvolvimento | você, com `npm run db:migrate` |
| Preview (Vercel) | branch por preview (integração Neon ↔ Vercel) | instância de desenvolvimento | build do preview, só com `MIGRATE_PREVIEW=true` |
| Produção (Vercel) | branch **`main`** | instância de produção | build de produção da API (`vercel-build`) |

A connection string de produção nunca vai para o `.env` local nem para o ambiente Preview da Vercel.

## Passos

1. **Pré-voo**
   - `gh auth status` deve estar logado. Se não estiver, peça ao usuário para rodar `gh auth login` ele mesmo (nunca digite credenciais).
   - Leia `TEMPLATE_REPO` na seção "Configuração" acima (se ainda for o placeholder, siga as instruções de lá).
   - Descubra o dono do repositório novo: `gh api user -q .login` (ou a organização que o usuário indicar).
   - Confirme que `<pasta-mãe>\<nome>` não existe.

2. **Repositório** (pergunte se o projeto novo será privado ou público; padrão `--private`)
   ```bash
   gh repo create <nome> --template <TEMPLATE_REPO> --private --clone   # ou --public
   ```
   Rode dentro da pasta-mãe e mova a sessão para a pasta nova (`change_directory`).

3. **Identidade do projeto**: `package.json` da raiz (`"name": "<nome>"`), `apps/web/lib/site.ts` (nome, descrição, dados da empresa) e o título do `README.md` com uma linha sobre o objetivo.

4. **Banco (Neon)** via MCP do Neon, com confirmação antes de criar recursos:
   - Projeto `<nome>` na região mais próxima (ex. `aws-sa-east-1`). A branch padrão `main` é a **produção**.
   - Crie a branch **`dev`** a partir da `main` e pegue a connection string *pooled* dela com `get_connection_string` (branch `dev`). Essa é a única que vai para o `.env` local.
   - Anote o host do endpoint da `main` sem `-pooler` (ex. `ep-cool-123456.sa-east-1.aws.neon.tech`): vai em `PRODUCTION_DATABASE_HOST` (não é segredo).

5. **Variáveis locais**
   - Copie `apps/api/.env.example` → `apps/api/.env` e `apps/web/.env.example` → `apps/web/.env`.
   - `DATABASE_URL` = string da branch `dev`. `PRODUCTION_DATABASE_HOST` = host da `main`.
   - Clerk (instância de desenvolvimento), R2 e módulos opcionais: o usuário cola as chaves no `.env` ele mesmo. Nunca peça nem repita segredos no chat. Módulos desligados ficam vazios.
   - Desenvolvimento local dispensa Upstash/Turnstile (aviso no console); produção exige ambos ou o desligamento explícito (`RATE_LIMIT_DISABLED`/`TURNSTILE_DISABLED`).

6. **Instalar e validar**
   ```bash
   npm install
   npm run db:migrate        # aplica na branch dev (DATABASE_URL do .env)
   npm run lint && npm run typecheck && npm test && npm run build
   ```
   Suba `npm run dev` e confira `GET http://localhost:3000/health` e a home em `:5173`.

7. **Commit e push**: commit "Configura <nome> a partir do template" e `git push`. O CI roda lint, testes (PGlite e Postgres real), build e E2E público.

8. **Deploy (Vercel)**, com confirmação do usuário antes de criar recursos (detalhes no `/configurar-projeto`, passo 6):
   - Dois projetos: `<nome>-web` (Root Directory `apps/web`) e `<nome>-api` (Root Directory `apps/api`; build `npm run vercel-build` já fixado no `vercel.json`, que aplica as migrações antes de publicar).
   - Integração **Neon ↔ Vercel** no projeto da API: Production = branch `main`; Preview = uma branch por preview. Nunca coloque a URL de produção no ambiente Preview.
   - Variáveis por ambiente. Web: `API_URL` (Production = URL da API; Preview = `https://<nome>-api-git-{branch}-<time>.vercel.app`). API: `APP_URL`, `CORS_ORIGINS`, `AUTHORIZED_PARTY_PATTERN` (previews), `PRODUCTION_DATABASE_HOST`, `CRON_SECRET`, `TURNSTILE_SECRET_KEY`, Upstash.
   - GitHub (environment `production`): `DATABASE_URL_UNPOOLED` (backup e migração manual) e os opcionais do backup (`R2_BACKUP_*`).

9. **Pós-deploy**: a retenção roda pelo Vercel Cron (`/cron/retention`, precisa de `CRON_SECRET`); com QStash, alternativamente `schedule("cleanup-old-records", "0 7 * * *", {})`. Defina o primeiro admin no Clerk (`publicMetadata.role = "admin"`).

10. **Relatório**: link do repositório, URLs da Vercel, pasta local, projeto e branches do Neon, módulos ligados/desligados, o que falta o usuário fazer (chaves pendentes, CORS do bucket R2, webhooks do Stripe e do Clerk, domínio no Resend, Turnstile, campos de `lib/site.ts`) e próximo passo: `/planejar` com o briefing do projeto.

## Regras

- Siga o `CLAUDE.md` do projeto gerado para qualquer mudança de código.
- Não altere o repositório `TEMPLATE_REPO` ao criar um projeto; melhorias no esqueleto vão para o template só quando o usuário pedir.
- Segredos só nos `.env` (que estão no `.gitignore`) e nos painéis (Vercel, GitHub Secrets); nunca em commits, URLs ou `NEXT_PUBLIC_*`.
- Nunca rode migração ou comando de escrita contra a branch `main` (produção) a partir da máquina local.
