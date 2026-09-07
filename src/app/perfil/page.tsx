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
      <h1 className="page-title">Meu perfil</h1>
      <p className="page-intro">Atualize seus dados e sua senha.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <section className="card space-y-4 p-6">
          <h2 className="section-head text-sm font-medium text-ink">Dados pessoais</h2>
          <AvatarUpload name={user.name} initialAvatarUrl={user.avatar_url} />
          <ProfileForm user={user} />
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="section-head text-sm font-medium text-ink">Senha</h2>
          <PasswordForm />
        </section>
      </div>
    </AppShell>
  );
}
