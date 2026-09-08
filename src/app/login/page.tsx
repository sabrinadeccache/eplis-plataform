import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; cadastro?: string; erro?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Entrar na sua conta"
      subtitle="Use o e-mail e a senha do seu cadastro."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="link font-medium">
            Cadastre-se
          </Link>
        </>
      }
    >
      <LoginForm
        justReset={params.reset === "1"}
        justSignedUp={params.cadastro === "1"}
        accountGone={params.erro === "conta"}
        sessionExpired={params.erro === "sessao"}
      />
    </AuthShell>
  );
}
