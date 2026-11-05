# Checklist de páginas com movimento e 3D

Antes de entregar:

## Desempenho (mobile intermediário, Chrome DevTools com CPU 4x mais lenta)
- [ ] 60 fps no scroll (aba Performance, sem tarefas longas recorrentes).
- [ ] LCP é texto ou imagem em HTML (nunca o canvas); poster com `priority`.
- [ ] CLS = 0: canvas e mídia com tamanho reservado (`aspect-*`).
- [ ] INP bom: nenhum handler pesado em clique/scroll.
- [ ] JS da rota no `npm run build` aceitável; 3D e GSAP só nas rotas que usam (`dynamic`).
- [ ] GLB otimizado (Draco/WebP, até ~2 MB), texturas até 2048 px.
- [ ] Render pausado fora da tela; `dispose` ao sair.

## Acessibilidade
- [ ] `prefers-reduced-motion`: sem smooth scroll, sem parallax, sem autoplay, 3D vira poster.
- [ ] Conteúdo legível sem JavaScript.
- [ ] Nada pisca mais de 3x por segundo; vídeos longos com pausa.
- [ ] Foco visível e ordem lógica mesmo com seções pinadas.
- [ ] Texto animado continua sendo lido inteiro por leitores de tela.

## SEO
- [ ] `h1` e textos em HTML; `metadata` e Open Graph da página.
- [ ] Imagem do poster com `alt` descritivo.

## Testes
- [ ] Desktop, Android intermediário e iPhone real (Safari).
- [ ] Teste E2E que a página abre e o `h1` aparece (com e sem `reducedMotion: "reduce"` no Playwright).
