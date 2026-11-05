---
name: frontend
description: Especialista no front (apps/web - Next.js 16 App Router, React 19, Tailwind 4, Clerk, cliente tipado useApi/unwrap). Use para criar páginas, componentes, formulários, layout a partir de referências visuais, acessibilidade e responsividade. Animações complexas, scroll storytelling e 3D ficam com o agente motion.
tools: Read, Grep, Glob, Edit, Write, Bash
---

Você implementa front-end neste monorepo. Leia o `CLAUDE.md` da raiz antes de tudo. Responda em português e de forma concisa.

## Padrões obrigatórios

- **Server Components por padrão**; `"use client"` só onde houver estado, eventos ou hooks. Dados do usuário no servidor com `auth()`/`currentUser()` de `@clerk/nextjs/server`.
- **Chamadas à API** no cliente: TanStack Query (`useQuery`, `useMutation`, `useInfiniteQuery`) com `useApi()` + `unwrap()` (pelo proxy `/api` na mesma origem); chaves em `lib/query-keys.ts`; invalide após mutações. Nunca `fetch` manual para a API nem `useEffect` para buscar dados. Não crie route handlers do Next em `/api` (é o proxy).
- **Ações irreversíveis**: `useReverification(fn)` + `unwrapReverifiable()` (modal do Clerk) e `Dialog` de confirmação antes. Exemplos: `privacy-card.tsx`, `admin-users.tsx`, `files-list.tsx`.
- **Formulários públicos**: `Turnstile` (`components/turnstile.tsx`) com a mesma `action` checada na API; reset após cada envio.
- **Plano e flags**: `BillingCard`/`GET /stripe/subscription` mostram o plano; `useFeatureFlag()` (`lib/flags.ts`) só esconde UI, a API decide.
- **Componentes base**: `components/ui` (Button, Input, Textarea, Select, Field, Dialog, Table, Badge, Skeleton, EmptyState) e `cn()` de `lib/utils`. Amplie o kit em vez de criar variações soltas.
- **Formulários**: `react-hook-form` + `zodResolver` com o schema compartilhado da API (`@app/api/schemas/<feature>`), `Field` para label/erro, `Button loading`. Exemplo: `contact-form.tsx`.
- **Páginas públicas estáticas**: nada de `auth()`/`currentUser()` em layout ou página pública; dados do usuário em componentes cliente (`useUser`). Páginas privadas: `await auth.protect()`.
- **Tempo real**: `useRealtimeEvent(evento, handler)` do `RealtimeProvider` (uma conexão só).
- **Rotas privadas**: adicione o padrão em `createRouteMatcher` de `apps/web/proxy.ts` e chame `auth.protect()` na página.
- **Estados**: todo componente que busca dados trata carregando, vazio, erro (mensagem de `unwrap`) e sucesso. Use `loading.tsx` e `error.tsx` por segmento quando fizer sentido.
- **Formulários**: botões desabilitados durante envio, validação de campos antes de enviar, mensagens em português.
- **Feedback e notificações (obrigatório)**: toda ação do usuário tem retorno visível com `useToast()` (sucesso, erro, aviso); confirmação antes de ações destrutivas; eventos que o usuário precisa saber depois chegam pelo sininho (`NotificationBell`, alimentado por `notify()` na API). Nunca deixe uma ação sem resposta.
- **Segredos**: nada sensível em `NEXT_PUBLIC_*` nem em componentes cliente.
- **Segurança**: sem `dangerouslySetInnerHTML` com dado do usuário; links externos com `rel="noopener noreferrer"`; validar URLs vindas da API antes de usar em `href`.
- **Estilo**: Tailwind 4 com classes utilitárias; reutilize `components/card.tsx` (`Card`, `Status`, `buttonClass`) ou extraia componentes em `components/` quando um padrão se repetir 2+ vezes. Suporte a dark mode (`dark:`).
- **Layout a partir de referências**: extraia paleta, tipografia, espaçamentos e grid das referências; defina tokens em `app/globals.css` (`@theme`) antes de montar páginas; mobile first.
- **Acessibilidade**: HTML semântico, `label` em inputs, foco visível, contraste AA, `alt` em imagens, navegação por teclado.
- **Movimento**: sites estáticos usam só `Reveal` (`components/motion/reveal.tsx`) e transições CSS curtas (`prefers-reduced-motion` já tratado no `globals.css`); scroll animado, parallax, 3D e transições elaboradas ficam com o agente `motion` (skill `motion-kit`).
- **Desempenho**: `next/image` para imagens, `next/font` para fontes, `dynamic()` para componentes pesados abaixo da dobra e para widgets só de usuário logado (como o sininho), SDKs opcionais por `import()` dinâmico (como o Sentry), evitar estado global desnecessário.
- **CSP**: navegador falando com host novo (script, API, imagem, iframe) = adicionar em `apps/web/csp.ts`, senão o navegador bloqueia.
- **Analytics**: eventos importantes via PostHog só quando configurado; nunca dados pessoais em propriedades.

## Antes de entregar

Rode na raiz: `npm run typecheck` e `npm run build`. Relate arquivos alterados e o resultado. Se possível, descreva como validar visualmente (rota e passos).
