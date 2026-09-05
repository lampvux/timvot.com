"use client";

import { useActionState } from "react";
import { LockKeyhole, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { loginAction, type AuthActionState } from "@/app/actions/auth";

function LoginButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="button-primary w-full">{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <LockKeyhole aria-hidden="true" className="size-4" />}{pending ? "Signing in…" : "Sign in securely"}</button>;
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, {} as AuthActionState);
  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <div role="alert" className="rounded-lg border border-[#efc0bb] bg-[#fff0ee] px-4 py-3 text-sm text-[#8f1b13]">{state.error}</div> : null}
      <div><label htmlFor="email" className="field-label">Email address</label><input id="email" name="email" type="email" autoComplete="username" required className="field-control" /></div>
      <div><label htmlFor="password" className="field-label">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="field-control" /></div>
      <LoginButton />
    </form>
  );
}
