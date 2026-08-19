"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ds/primitives";
import { signInWithProvider, type AuthState } from "@/lib/auth-actions";
import type { OAuthProvider } from "@/lib/supabase/config";
import type { Locale } from "@/i18n/routing";

/**
 * Social sign-in buttons.
 *
 * The marks are inlined rather than pulled from Lucide, which carries no brand
 * icons, and rather than fetched from a CDN, which the design system does not
 * do. Both Google and Meta require their own glyph in their own colours, so
 * this is the one place where colour is not carrying meaning — it is carrying
 * identity, and substituting a neutral icon would breach their brand terms.
 */

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#1877F2"
        d="M18 9.055C18 4.054 13.97 0 9 0S0 4.054 0 9.055C0 13.575 3.291 17.32 7.594 18v-6.312H5.309V9.055h2.285V7.062c0-2.266 1.343-3.518 3.4-3.518.984 0 2.014.177 2.014.177v2.226h-1.135c-1.118 0-1.467.699-1.467 1.416v1.692h2.496l-.399 2.633h-2.097V18C14.709 17.32 18 13.575 18 9.055z"
      />
    </svg>
  );
}

const MARKS: Record<OAuthProvider, () => React.ReactElement> = {
  google: GoogleMark,
  facebook: FacebookMark,
};

export function OAuthButtons({
  providers,
  locale,
  disabled,
}: {
  providers: OAuthProvider[];
  locale: Locale;
  disabled?: boolean;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signInWithProvider,
    {},
  );

  if (providers.length === 0) return null;

  return (
    <div className="mt-5">
      {/* Hairline with the label sitting in it — separates without a shadow. */}
      <div className="flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-eyebrow uppercase tracking-wide text-tertiary">
          {t("orContinueWith")}
        </span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <form action={action} className="mt-4 flex flex-col gap-2.5">
        <input type="hidden" name="locale" value={locale} />

        {providers.map((provider) => {
          const Mark = MARKS[provider];
          return (
            <Button
              key={provider}
              type="submit"
              name="provider"
              value={provider}
              variant="secondary"
              size="lg"
              fullWidth
              disabled={disabled || pending}
            >
              <Mark />
              {t(provider === "google" ? "continueGoogle" : "continueFacebook")}
            </Button>
          );
        })}
      </form>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk"
        >
          {state.error === "providerDisabled"
            ? t("errorProviderDisabled")
            : state.error === "config"
              ? t("errorConfig")
              : t("errorGeneric")}
        </p>
      )}
    </div>
  );
}
