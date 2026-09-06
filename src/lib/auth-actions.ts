"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect as localeRedirect } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  REMEMBER_SESSION_COOKIE,
  REMEMBER_SESSION_MAX_AGE,
} from "@/lib/supabase/cookies";
import {
  SITE_URL,
  enabledOAuthProviders,
  type OAuthProvider,
} from "@/lib/supabase/config";
import type { Locale } from "@/i18n/routing";

/**
 * Supabase Auth, through server actions.
 *
 * Errors come back as strings the page renders in place — never a redirect to
 * an error page, because the user is three keystrokes from fixing it.
 */

export interface AuthState {
  error?: string;
  notice?: string;
  email?: string;
}

function localeOf(formData: FormData): Locale {
  const value = String(formData.get("locale") ?? "vi");
  return value === "en" ? "en" : "vi";
}

function rememberSessionOf(formData: FormData): boolean {
  return formData.get("remember") === "1";
}

async function setRememberSessionPreference(rememberSession: boolean) {
  const cookieStore = await cookies();

  if (!rememberSession) {
    cookieStore.delete(REMEMBER_SESSION_COOKIE);
    return;
  }

  cookieStore.set(REMEMBER_SESSION_COOKIE, "1", {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REMEMBER_SESSION_MAX_AGE,
  });
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rememberSession = rememberSessionOf(formData);
  if (!email || !password) return { error: "generic", email };

  const supabase = await createClient({ rememberSession });
  if (!supabase) return { error: "config" };

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      error: error.code === "email_not_confirmed" ? "emailNotConfirmed" : "generic",
      email,
    };
  }

  await setRememberSessionPreference(rememberSession);

  revalidatePath("/", "layout");
  // `redirect` throws, so control never reaches the end of this function.
  localeRedirect({ href: "/account", locale: localeOf(formData) });
  return {};
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!email || password.length < 8) {
    return { error: "generic", email };
  }
  if (password !== confirmPassword) {
    return { error: "passwordMismatch", email };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const locale = localeOf(formData);
  const callback = new URL("/auth/callback", SITE_URL);
  callback.searchParams.set("locale", locale);

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: String(formData.get("displayName") ?? "") },
      // Without this the confirmation link points at Supabase's own Site URL,
      // which is not necessarily where this deployment lives.
      emailRedirectTo: callback.toString(),
    },
  });

  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { notice: "checkEmail", email };
    }
    return { error: "generic", email };
  }
  return { notice: "checkEmail", email };
}

export async function resendVerification(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "generic" };

  const supabase = await createClient();
  if (!supabase) return { error: "config", email };

  const callback = new URL("/auth/callback", SITE_URL);
  callback.searchParams.set("locale", localeOf(formData));

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: callback.toString() },
  });

  if (error) {
    return {
      error: error.code === "over_email_send_rate_limit" ? "resendTooSoon" : "generic",
      email,
    };
  }

  return { notice: "verificationResent", email };
}

/**
 * Social sign-in.
 *
 * `signInWithOAuth` does not sign anyone in — it mints an authorisation URL and
 * stores a PKCE verifier in a cookie. We redirect the browser there; the
 * provider sends it back to /auth/callback with a code, which is exchanged for
 * a session against that verifier. Both halves have to run on the server for
 * the cookie to line up, which is why this is an action rather than a
 * client-side call.
 */
export async function signInWithProvider(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const provider = String(formData.get("provider") ?? "") as OAuthProvider;
  const locale = localeOf(formData);
  const rememberSession = rememberSessionOf(formData);

  // The form is rendered from the same list, so a value outside it means the
  // request did not come from our UI.
  if (!enabledOAuthProviders.includes(provider)) {
    return { error: "providerDisabled" };
  }

  const supabase = await createClient({ rememberSession });
  if (!supabase) return { error: "config" };

  const callback = new URL("/auth/callback", SITE_URL);
  callback.searchParams.set("locale", locale);
  callback.searchParams.set("next", `/${locale}/account`);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callback.toString(),
      // Ask Google for a refresh token rather than an access token that
      // expires in an hour and cannot be renewed silently.
      queryParams:
        provider === "google"
          ? { access_type: "offline", prompt: "consent" }
          : undefined,
    },
  });

  if (error || !data?.url) return { error: "generic" };

  await setRememberSessionPreference(rememberSession);

  // An absolute URL on the provider's domain, so this is next/navigation's
  // redirect rather than the locale-aware one.
  redirect(data.url);
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "generic" };

  const locale = localeOf(formData);
  const callback = new URL("/auth/callback", SITE_URL);
  callback.searchParams.set("locale", locale);
  callback.searchParams.set("next", `/${locale}/reset-password`);

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callback.toString(),
  });

  if (error) return { error: "generic" };
  return { notice: "checkResetEmail" };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || password.length < 8) {
    return { error: "generic" };
  }

  if (password !== confirmPassword) {
    return { error: "passwordMismatch" };
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) return { error: "generic" };

  revalidatePath("/", "layout");
  localeRedirect({ href: "/account", locale: localeOf(formData) });
  return {};
}

export async function signOut(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  await setRememberSessionPreference(false);
  revalidatePath("/", "layout");
  localeRedirect({ href: "/", locale: localeOf(formData) });
}
