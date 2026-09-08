# Shuttlecraft Admin

Standalone Next.js admin application for the Shuttlecraft catalogue and
marketplace. It has its own dependency tree and Vercel deployment, while using
the same Supabase project as the public storefront.

## Local setup

1. Copy `.env.example` to `.env.local` and provide the Supabase values.
2. From the repository root, apply all migrations in `supabase/migrations`.
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

Seller applications are reviewed at `/content/seller-applications`. Approval is
transactional: it creates the applicant's seller record, promotes the profile to
the seller role, and only then allows listing submissions. New seller offers
enter catalogue review instead of publishing immediately.

## Racket media mapping

Every racket edit page includes a **Media mapping** panel. It shows the expected
`<brand>/<model>/` Storage folder, the gallery hero, thumbnail readiness, and any
misplaced files. Staff can choose a gallery image as the hero or open an image to
change its racket mapping. Saving a changed mapping moves every image from that
manufacturer source page, keeps original/thumbnail object paths paired, and
updates both rackets' denormalised hero pointers. New admin uploads are stored in
the same enforced folder layout and receive a card-sized WebP thumbnail.
