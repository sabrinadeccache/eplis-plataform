"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = { error: null };

export function LoginForm({
  justReset,
  justSignedUp,
  accountGone,
  accountBlocked,
  sessionExpired,
}: {
  justReset: boolean;
  justSignedUp?: boolean;
  accountGone?: boolean;
  accountBlocked?: boolean;
  sessionExpired?: boolean;
}) {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <div className="space-y-5">
      {sessionExpired && (
        <p role="status" className="note note-caution">
          Sua sessão expirou. Entre novamente para continuar de onde parou — seu
          progresso no simulado foi salvo.
        </p>
      )}

      {accountGone && (
        <p role="status" className="note note-caution">
          Sua sessão foi encerrada porque esta conta não está mais ativa. Entre novamente
          ou crie uma nova conta.
        </p>
      )}

      {accountBlocked && (
        <p role="alert" className="note note-caution">
          Esta conta está bloqueada ou inativa. Fale com o administrador para revisar o
          acesso.
        </p>
      )}

      {justReset && (
        <p role="status" className="note note-success">
          Senha redefinida. Entre com a nova senha.
        </p>
      )}

      {justSignedUp && (
        <p role="status" className="note note-success">
          Cadastro criado. Confirme seu e-mail pelo link que enviamos e entre com sua
          senha.
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="field-label">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field-input"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="field-label">
              Senha
            </label>
            <Link href="/esqueci-senha" className="link text-xs">
              Esqueceu a senha?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field-input"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}

        <SubmitButton>Entrar</SubmitButton>
      </form>
    </div>
  );
}
