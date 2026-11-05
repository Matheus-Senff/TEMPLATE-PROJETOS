---
name: motion-kit
description: Receitas prontas de front-end em movimento para este template - smooth scroll (Lenis + GSAP ScrollTrigger), seções pinadas e scrub, texto animado, parallax, cenas 3D com React Three Fiber controladas pelo scroll, transições de página e o checklist de desempenho/acessibilidade. Use quando o projeto tiver animação de scroll, 3D/WebGL, hero animado ou microinterações; para sites estáticos use só o que já existe (Reveal e tokens).
---

# Motion kit

Leia primeiro a decisão abaixo, depois só a receita que o projeto precisa. Instale dependências apenas quando a receita for usada (o template não as traz para não pesar em sites estáticos).

## 1. Decida o nível de movimento (com o cliente ou pelas referências)

| Nível | Quando | Use |
|---|---|---|
| **Estático** | Sistema, painel, site institucional sóbrio | Nada além de `Reveal` (`apps/web/components/motion/reveal.tsx`) e transições CSS curtas |
| **Animado** | Landing page, portfólio, produto | `motion` (microinterações) e/ou GSAP + ScrollTrigger + Lenis (scroll) |
| **3D** | Hero imersivo, produto 3D, storytelling | React Three Fiber + drei, controlado pelo scroll via GSAP, sempre com poster de fallback |

Regra: a página precisa funcionar e ser legível **sem** animação (reduced motion, JS desligado, celular fraco). Conteúdo e `h1` sempre em HTML, nunca só dentro do canvas.

## 2. Instalação por necessidade

```bash
npm i gsap @gsap/react lenis
```
```bash
npm i motion
```
```bash
npm i three @react-three/fiber @react-three/drei && npm i -D @types/three
```
```bash
npm i @react-three/postprocessing
```

## 3. Organização

- `apps/web/lib/motion.ts`: tokens (durações, easings, breakpoints) e `isLowEndDevice()` (já existe).
- `apps/web/components/motion/`: primitivas (`Reveal` e `useReducedMotion` já existem; `SmoothScroll`, `Parallax`, `SplitHeading`, `Marquee`, `PinnedSection`).
- `apps/web/components/three/`: cenas, modelos, materiais e `Scene3D` (wrapper com fallback).
- `public/models/` (GLB otimizado), `public/posters/` (imagem do primeiro quadro da cena).

## 4. Receitas

| Arquivo | Conteúdo |
|---|---|
| `references/smooth-scroll.md` | Lenis + GSAP ticker + ScrollTrigger, âncoras, reduced motion |
| `references/scroll-animations.md` | `useGSAP`, seção pinada com scrub, parallax, texto dividido acessível, marquee, `gsap.matchMedia` |
| `references/three-scroll.md` | Canvas com `dynamic(ssr:false)`, poster, câmera guiada pelo scroll, GLB com Draco, `PerformanceMonitor`, pausa fora da tela |
| `references/micro-and-transitions.md` | `motion/react` (hover, layout, listas), transição de página no App Router |
| `references/checklist.md` | Metas de desempenho, acessibilidade, SEO e testes em aparelho real |

Antes de entregar qualquer página com movimento, passe pelo `references/checklist.md` e peça ao agente `desempenho` para medir.
