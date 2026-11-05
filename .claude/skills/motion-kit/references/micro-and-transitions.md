# Microinterações e transições de página (motion/react)

## Microinterações

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";

export function HoverCard({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -4 }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="rounded-lg border p-5"
    >
      {children}
    </motion.div>
  );
}
```

Listas que entram/saem: `AnimatePresence` + `motion.li` com `layout`. Use `LazyMotion` + `domAnimation` (`m.div`) para reduzir o bundle quando a página usar poucas animações.

## Transição de página (App Router)

`template.tsx` é remontado a cada navegação, então a entrada anima sem configuração extra:

```tsx
// apps/web/app/(marketing)/template.tsx
"use client";

import { motion } from "motion/react";

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
```

Animação de saída entre rotas no App Router não é confiável; prefira entrada suave. Para transições compartilhadas entre páginas, avalie a View Transitions API (`experimental.viewTransition` no Next) com fallback.
