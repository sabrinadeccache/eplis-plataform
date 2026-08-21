import { AppNav } from "@/components/layout/app-nav";
import type { UserRow } from "@/types/database";

export function AppShell({ user, children }: { user: UserRow; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <AppNav user={user} />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
