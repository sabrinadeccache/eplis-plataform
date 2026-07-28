import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import type { UserRow } from "@/types/database";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/fase1", label: "Fase 1" },
  { href: "/fase2", label: "Fase 2" },
  { href: "/historico", label: "Histórico" },
];

export function AppShell({ user, children }: { user: UserRow; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-4">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              EPLIS Trainer
            </span>
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
          <form action={signOut} className="flex items-center gap-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{user.name}</span>
            <button
              type="submit"
              className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
