# Shuttlecraft Admin

Standalone Next.js admin application for the Shuttlecraft catalogue and
marketplace. It has its own dependency tree and Vercel deployment, while using
the same Supabase project as the public storefront.

## Local setup

1. Copy `.env.example` to `.env.local` and provide the Supabase values.
2. From the repository root, apply `supabase/migrations/20260905000000_admin_console.sql`.
3. In this directory, run `npm run bootstrap:admin` once.
4. Run `npm run dev` and open `http://localhost:3000/login`.

The bootstrap command is idempotent. The password is passed directly to
Supabase Auth and is never written to the application database.

## Separate Vercel project

Create a second Vercel project from the same Git repository and set **Root
Directory** to `admin`. Keep the public-site project rooted at the repository
root. Add the variables from `.env.example` to the admin project only; the
service-role key must never be added to a `NEXT_PUBLIC_` variable.

Production deployment is isolated in `.github/workflows/deploy-admin.yml`. Add
the `ADMIN_VERCEL_TOKEN` secret plus the `ADMIN_VERCEL_ORG_ID` and
`ADMIN_VERCEL_PROJECT_ID` repository variables. The workflow runs only when
`admin/**` changes on `main` (or when manually dispatched), verifies this app,
builds a prebuilt artifact, and deploys it to the admin Vercel project. Disable
Git production deployments in that Vercel project to avoid duplicate releases;
preview deployments may remain enabled for pull requests.

Before promotion, run:

```bash
npm run typecheck
npm run lint
npm run build
```
