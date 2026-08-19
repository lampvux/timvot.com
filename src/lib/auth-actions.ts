"use server";

import { revalidatePath } from "next/cache";
import { redirect as localeRedirect } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
}

function localeOf(formData: FormData): Locale {
  const value = String(formData.get("locale") ?? "vi");
  return value === "en" ? "en" : "vi";
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (error) return { error: "generic" };

  revalidatePath("/", "layout");
  // `redirect` throws, so control never reaches the end of this function.
  localeRedirect({ href: "/account", locale: localeOf(formData) });
  return {};
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const locale = localeOf(formData);
  const callback = new URL("/auth/callback", SITE_URL);
  callback.searchParams.set("locale", locale);

  const { error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    options: {
      data: { display_name: String(formData.get("displayName") ?? "") },
      // Without this the confirmation link points at Supabase's own Site URL,
      // which is not necessarily where this deployment lives.
      emailRedirectTo: callback.toString(),
    },
  });

  if (error) return { error: "generic" };
  return { notice: "checkEmail" };
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

  // The form is rendered from the same list, so a value outside it means the
  // request did not come from our UI.
  if (!enabledOAuthProviders.includes(provider)) {
    return { error: "providerDisabled" };
  }

  const supabase = await createClient();
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
  revalidatePath("/", "layout");
  localeRedirect({ href: "/", locale: localeOf(formData) });
}
