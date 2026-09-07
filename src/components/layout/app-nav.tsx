"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/actions";
import type { UserRow } from "@/types/database";

function navItemsFor(role: UserRow["role"]) {
  const home = { href: "/dashboard", label: "Página inicial" };
  const desempenho = { href: "/desempenho", label: "Desempenho" };
  if (role === "pilot") {
    return [home, { href: "/sdea", label: "SDEA" }, desempenho];
  }
  if (role === "admin") {
    return [
      home,
      { href: "/fase1", label: "Fase 1" },
      { href: "/fase2", label: "Fase 2" },
      { href: "/sdea", label: "SDEA" },
      desempenho,
    ];
  }
  return [
    home,
    { href: "/fase1", label: "Fase 1" },
    { href: "/fase2", label: "Fase 2" },
    desempenho,
  ];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const navItems = navItemsFor(user.role);

  return (
    <div className="mx-auto max-w-4xl px-6 py-3.5">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-ink">EPLIS Trainer</span>
          <span className="data text-[11px] text-muted">
            {user.role === "pilot" ? "SDEA" : "EPLIS"}
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className="nav-link"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={signOut} className="hidden items-center gap-4 md:flex">
          <ProfileLink user={user} active={isActive(pathname, "/perfil")} />
          <SignOutButton />
        </form>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Abrir menu"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-line text-muted md:hidden"
        >
          <span aria-hidden className="text-lg leading-none">
            {open ? "✕" : "☰"}
          </span>
        </button>
      </div>

      {open ? (
        <div className="mt-3.5 flex flex-col gap-0.5 border-t border-line pt-3.5 text-sm md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={
                isActive(pathname, item.href)
                  ? "rounded-md px-2 py-2 font-medium text-accent"
                  : "rounded-md px-2 py-2 text-muted hover:bg-sunken hover:text-ink"
              }
            >
              {item.label}
            </Link>
          ))}
          <div className="rounded-md px-2 py-2 hover:bg-sunken">
            <ProfileLink user={user} onClick={() => setOpen(false)} />
          </div>
          <form action={signOut}>
            <SignOutButton className="w-full px-2 py-2 text-left" />
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProfileLink({
  user,
  onClick,
  active,
}: {
  user: UserRow;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Link
      href="/perfil"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex items-center gap-2 text-sm font-medium text-accent"
          : "flex items-center gap-2 text-sm text-muted hover:text-ink"
      }
    >
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
      ) : null}
      Meu perfil
    </Link>
  );
}

function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="submit"
      className={`cursor-pointer text-sm text-muted hover:text-ink ${className}`}
    >
      Sair
    </button>
  );
}
