"use client";

import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "./ui/button";

/** Signed-in only: loaded on demand so anonymous visitors of public pages never download it. */
const NotificationBell = dynamic(() => import("./notification-bell").then((m) => m.NotificationBell), {
  ssr: false,
  loading: () => <span className="inline-block h-8 w-8" aria-hidden="true" />,
});

/** Client-side so public pages stay static (no auth() on the server for the header). */
export function HeaderAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="h-8 w-40" aria-hidden="true" />;

  if (!isSignedIn) {
    return (
      <>
        <SignInButton>
          <Button variant="ghost" size="sm">
            Entrar
          </Button>
        </SignInButton>
        <SignUpButton>
          <Button size="sm">Criar conta</Button>
        </SignUpButton>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard" className="hover:underline">
        Painel
      </Link>
      <NotificationBell />
      <UserButton />
    </>
  );
}
