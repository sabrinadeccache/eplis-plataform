"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import type { UserRow } from "@/types/database";

function navItemsFor(role: UserRow["role"]) {
  if (role === "pilot") {
    return [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/sdea", label: "SDEA" },
      { href: "/desempenho", label: "Desempenho" },
    ];
  }
  return [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/fase1", label: "Fase 1" },
    { href: "/fase2", label: "Fase 2" },
    { href: "/desempenho", label: "Desempenho" },
  ];
}

export function AppNav({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const NAV_ITEMS = navItemsFor(user.role);

  return (
    <div className="mx-auto max-w-4xl px-6 py-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          EPLIS Trainer
        </span>

        <nav className="hidden items-center gap-4 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={signOut} className="hidden items-center gap-3 md:flex">
          <ProfileLink user={user} />
          <SignOutButton />
        </form>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 md:hidden dark:border-zinc-800 dark:text-zinc-400"
        >
          {open ? (
            <span aria-hidden className="text-lg leading-none">
              ✕
            </span>
          ) : (
            <span aria-hidden className="text-lg leading-none">
              ☰
            </span>
          )}
        </button>
      </div>

      {open ? (
        <div className="mt-4 flex flex-col gap-1 border-t border-zinc-200 pt-4 md:hidden dark:border-zinc-800">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              {item.label}
            </Link>
          ))}
          <div className="rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <ProfileLink user={user} onClick={() => setOpen(false)} />
          </div>
          <form action={signOut}>
            <SignOutButton className="w-full rounded-md px-2 py-2 text-left" />
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProfileLink({ user, onClick }: { user: UserRow; onClick?: () => void }) {
  return (
    <Link
      href="/perfil"
      onClick={onClick}
      className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
    >
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
      ) : null}
      {user.name}
    </Link>
  );
}

function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="submit"
      className={`text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 ${className}`}
    >
      Sair
    </button>
  );
}
