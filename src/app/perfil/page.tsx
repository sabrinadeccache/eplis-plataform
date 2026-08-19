import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { ProfileForm } from "@/components/perfil/profile-form";
import { PasswordForm } from "@/components/perfil/password-form";
import { AvatarUpload } from "@/components/perfil/avatar-upload";

export default async function PerfilPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Meu perfil</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Atualize seus dados e sua senha.
      </p>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Dados pessoais</h2>
          <AvatarUpload name={user.name} initialAvatarUrl={user.avatar_url} />
          <ProfileForm user={user} />
        </section>

        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Senha</h2>
          <PasswordForm />
        </section>
      </div>
    </AppShell>
  );
}
