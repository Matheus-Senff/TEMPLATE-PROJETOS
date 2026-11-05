# Animações de scroll com GSAP

Sempre `useGSAP` com `scope` (limpa tudo no unmount) e `gsap.matchMedia()` para reduced motion e breakpoints. Anime só `transform` e `opacity`.

## Seção pinada com scrub

```tsx
// apps/web/components/motion/pinned-section.tsx
"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function PinnedSection() {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 768px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
        if (!motion) return;
        gsap
          .timeline({
            scrollTrigger: { trigger: scope.current, start: "top top", end: desktop ? "+=150%" : "+=80%", scrub: true, pin: desktop },
          })
          .from(".js-title", { yPercent: 40, opacity: 0 })
          .to(".js-media", { scale: 1.15 }, "<");
      });
    },
    { scope },
  );

  return (
    <section ref={scope} className="relative flex min-h-svh items-center overflow-hidden">
      <h2 className="js-title text-5xl font-bold">Título da seção</h2>
      <div className="js-media absolute inset-0 -z-10 bg-[url(/posters/secao.webp)] bg-cover" />
    </section>
  );
}
```

## Parallax leve

```tsx
useGSAP(
  () => {
    gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>("[data-speed]").forEach((el) => {
        gsap.to(el, {
          yPercent: Number(el.dataset.speed) * -20,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        });
      });
    });
  },
  { scope },
);
// <img data-speed="1" ... />  <div data-speed="0.5" ... />
```

## Texto dividido acessível (SplitText é gratuito no GSAP 3.13+)

```tsx
import { SplitText } from "gsap/SplitText";
gsap.registerPlugin(SplitText);

useGSAP(
  () => {
    gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
      const split = SplitText.create(".js-heading", { type: "words,lines", mask: "lines", aria: "auto" });
      gsap.from(split.words, { yPercent: 100, stagger: 0.04, duration: 0.8, ease: "power3.out" });
      return () => split.revert();
    });
  },
  { scope },
);
```
`aria: "auto"` mantém o texto lido inteiro por leitores de tela. Espere as fontes (`document.fonts.ready`) antes de dividir.

## Marquee só com CSS

```tsx
<div className="overflow-hidden">
  <div className="flex w-max animate-[marquee_30s_linear_infinite] gap-12 motion-reduce:animate-none">
    {[...logos, ...logos].map((logo, i) => <img key={i} src={logo} alt="" className="h-8" />)}
  </div>
</div>
// globals.css: @keyframes marquee { to { transform: translateX(-50%); } }
```

## Regras

- Um `ScrollTrigger` por intenção; `markers: true` só em desenvolvimento.
- Nada de `scroll` listener manual; use ScrollTrigger ou `animation-timeline: view()` (CSS) com fallback.
- `will-change: transform` só nos elementos animados e só enquanto animam.
- Mobile: menos pin (pin em telas pequenas costuma travar o toque), durações menores.
