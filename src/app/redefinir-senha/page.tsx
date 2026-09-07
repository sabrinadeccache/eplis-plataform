"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { evaluatePasswordStrength } from "@/lib/auth/password";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { AuthShell } from "@/components/auth/auth-shell";

type Status = "checking" | "ready" | "invalid" | "submitting" | "done";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // O client do browser processa o link de recuperação (hash/código na URL)
    // assim que é criado — nesse ponto já pode existir sessão; se não,
    // esperamos o evento PASSWORD_RECOVERY dele mesmo processar.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus((s) => (s === "checking" ? "ready" : s));
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      setStatus((s) => (s === "checking" ? "invalid" : s));
    }, 4000);

    return () => {
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!evaluatePasswordStrength(password).isStrongEnough) {
      setError(
        "Senha muito fraca — use ao menos 8 caracteres combinando letras maiúsculas, minúsculas, números e símbolos (pelo menos 3 desses tipos).",
      );
      return;
    }

    setStatus("submitting");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setStatus("ready");
      return;
    }

    setStatus("done");
    await supabase.auth.signOut();
    router.push("/login?reset=1");
  }

  return (
    <AuthShell title="Redefinir senha">
      {status === "checking" && (
        <p className="text-sm text-muted">Verificando o link…</p>
      )}

      {status === "invalid" && (
        <p role="alert" className="note note-danger">
          Link inválido ou expirado. Peça um novo link em{" "}
          <a href="/esqueci-senha" className="link">
            esqueci minha senha
          </a>
          .
        </p>
      )}

      {(status === "ready" || status === "submitting" || status === "done") && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="password" className="field-label">
              Nova senha
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input"
            />
            <PasswordStrengthMeter password={password} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm_password" className="field-label">
              Confirmar nova senha
            </label>
            <input
              id="confirm_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="field-input"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "submitting" || status === "done"}
            className="btn btn-primary w-full"
          >
            {status === "submitting" ? "Salvando…" : "Redefinir senha"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
