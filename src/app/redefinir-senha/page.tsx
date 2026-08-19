"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { evaluatePasswordStrength } from "@/lib/auth/password";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";

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
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Redefinir senha
          </h1>
        </div>

        {status === "checking" && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Verificando o link…
          </p>
        )}

        {status === "invalid" && (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
            Link inválido ou expirado. Peça um novo link em{" "}
            <a href="/esqueci-senha" className="underline">
              esqueci minha senha
            </a>
            .
          </p>
        )}

        {(status === "ready" || status === "submitting" || status === "done") && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <PasswordStrengthMeter password={password} />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="confirm_password"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
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
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting" || status === "done"}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {status === "submitting" ? "Salvando…" : "Redefinir senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
