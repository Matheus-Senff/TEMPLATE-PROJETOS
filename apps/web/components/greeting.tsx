"use client";

import { useUser } from "@clerk/nextjs";
import { Skeleton } from "./ui/misc";

/** Uses the Clerk session already in the browser (no server call to Clerk on every render). */
export function Greeting() {
  const { isLoaded, user } = useUser();
  if (!isLoaded) return <Skeleton className="h-8 w-48" />;
  return (
    <h1 className="text-2xl font-bold">
      Olá, {user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "usuário"}
    </h1>
  );
}
