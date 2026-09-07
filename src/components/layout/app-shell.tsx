import { AppNav } from "@/components/layout/app-nav";
import type { UserRow } from "@/types/database";

export function AppShell({ user, children }: { user: UserRow; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-paper">
      {/* Régua superior da "carta" — a única linha grossa da interface. */}
      <div className="h-0.5 bg-brand" />
      <header className="border-b border-line bg-surface">
        <AppNav user={user} />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
