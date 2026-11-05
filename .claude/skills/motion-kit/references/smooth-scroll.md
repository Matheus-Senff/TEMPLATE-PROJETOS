# Smooth scroll: Lenis + GSAP ScrollTrigger

Uma instância só, no layout (ou no layout do grupo de páginas de marketing). Com reduced motion, nada de smooth scroll.

```tsx
// apps/web/components/motion/smooth-scroll.tsx
"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactLenis, useLenis, type LenisRef } from "lenis/react";
import "lenis/dist/lenis.css";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";

gsap.registerPlugin(ScrollTrigger);

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<LenisRef>(null);
  const reduced = useReducedMotion();

  // GSAP drives Lenis (one RAF loop for everything).
  useEffect(() => {
    const update = (time: number) => lenisRef.current?.lenis?.raf(time * 1000);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    return () => gsap.ticker.remove(update);
  }, []);

  // Keep ScrollTrigger in sync with Lenis' virtual scroll.
  useLenis(ScrollTrigger.update);

  if (reduced) return <>{children}</>;
  return (
    <ReactLenis root ref={lenisRef} options={{ autoRaf: false, lerp: 0.1, anchors: true }}>
      {children}
    </ReactLenis>
  );
}
```

Uso:

```tsx
// apps/web/app/(marketing)/layout.tsx
import { SmoothScroll } from "@/components/motion/smooth-scroll";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <SmoothScroll>{children}</SmoothScroll>;
}
```

Notas:
- Coloque o smooth scroll só nas páginas de marketing. Painel e formulários usam scroll nativo.
- Depois que fontes e imagens carregarem, chame `ScrollTrigger.refresh()` (ex.: `document.fonts.ready.then(() => ScrollTrigger.refresh())`).
- Elementos com scroll interno (modais, listas) recebem `data-lenis-prevent`.
- `scroll-margin-top` nas seções para âncoras não ficarem sob o header fixo.
