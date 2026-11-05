# 3D com React Three Fiber controlado pelo scroll

Princípios: o canvas nunca bloqueia o primeiro paint (carrega depois, `ssr: false`), sempre há um **poster** do mesmo tamanho, e o scroll alimenta uma ref (sem re-render do React a cada frame).

## Wrapper com fallback

```tsx
// apps/web/components/three/scene-3d.tsx
"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useSyncExternalStore } from "react";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { isLowEndDevice } from "@/lib/motion";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

const supportsWebGL = () => {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
};

const noop = () => () => {};
let capable: boolean | undefined;
const canRenderScene = () => (capable ??= supportsWebGL() && !isLowEndDevice());

export function Scene3D({ poster, alt }: { poster: string; alt: string }) {
  const reduced = useReducedMotion();
  // false on the server and on the first client render (poster), true after hydration when the device can handle it.
  const canRender = useSyncExternalStore(noop, canRenderScene, () => false);

  return (
    <div className="relative aspect-[16/9] w-full">
      <Image src={poster} alt={alt} fill priority sizes="100vw" className="object-cover" />
      {canRender && !reduced && (
        <div className="absolute inset-0">
          <HeroScene />
        </div>
      )}
    </div>
  );
}
```

## Cena com câmera guiada pelo scroll

```tsx
// apps/web/components/three/hero-scene.tsx
"use client";

import { AdaptiveDpr, Environment, PerformanceMonitor, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

function Model({ progress }: { progress: React.RefObject<number> }) {
  const { scene } = useGLTF("/models/produto.glb", true); // true = Draco decoder (CDN da drei)
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  useFrame((_, delta) => {
    const p = progress.current ?? 0;
    if (group.current) group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, p * Math.PI * 2, 4, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, 6 - p * 3, 4, delta);
  });

  return <primitive ref={group} object={scene} />;
}

export default function HeroScene() {
  const progress = useRef(0);
  const [dpr, setDpr] = useState(1.5);
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const trigger = ScrollTrigger.create({
      trigger: document.body,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => (progress.current = self.progress),
    });
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    if (wrapper.current) io.observe(wrapper.current);
    return () => {
      trigger.kill();
      io.disconnect();
    };
  }, []);

  return (
    <div ref={wrapper} className="h-full w-full">
      <Canvas dpr={dpr} frameloop={visible ? "always" : "never"} camera={{ position: [0, 0, 6], fov: 35 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
        <AdaptiveDpr pixelated />
        <Suspense fallback={null}>
          <Model progress={progress} />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/models/produto.glb", true);
```

## Modelos e texturas

- Otimize todo GLB: `npx @gltf-transform/cli optimize entrada.glb public/models/produto.glb --compress draco --texture-compress webp --texture-size 2048`.
- Orçamento: até ~2 MB por cena e ~100k triângulos no mobile; texturas no máximo 2048 px.
- Para cenas estáticas use `frameloop="demand"` e chame `invalidate()` quando algo mudar.
- Não crie objetos dentro de `useFrame`; reutilize vetores (`useMemo`).
- Spline (`@splinetool/react-spline`) só quando o designer entrega a cena pronta e o peso for aceitável; sempre com poster.

## Mobile e Safari

- Use `svh`/`dvh` em vez de `100vh`.
- Teste no iPhone real (limites de memória do WebGL no Safari).
- Em aparelho fraco, `Scene3D` já mostra só o poster.
