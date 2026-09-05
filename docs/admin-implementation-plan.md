# Shuttlecraft Admin implementation plan

## Product outcome

Create a standalone Next.js application in `/admin` that deploys as its own
Vercel project and manages the Supabase catalogue consumed by the public
Shuttlecraft website. The admin application owns its dependencies, build,
environment variables, authentication surfaces, and release flow. It shares
only the existing Supabase database and product-image storage with the public
site.

## Roles and permissions

| Capability | Admin | Manager |
| --- | --- | --- |
| View dashboard and content | Yes | Yes |
| Create and edit catalogue/content | Yes | Yes |
| Delete catalogue/content | Yes | Yes |
| Moderate reviews and offers | Yes | Yes |
| Upload and organize racket images | Yes | Yes |
| View the staff directory | Yes | No |
| Add, deactivate, or change staff roles | Yes | No |
| View all audit activity | Yes | Own activity only |

Every protected page verifies the live Supabase session through a server-only
data access layer. Every mutation repeats authentication and authorization;
the navigation and page shell are not treated as security boundaries.

## Initial owner account

The first admin is bootstrapped with `npm run bootstrap:admin` inside `/admin`.
Credentials come from `ADMIN_INITIAL_EMAIL` and `ADMIN_INITIAL_PASSWORD` in the
local or Vercel environment. No default password or privileged key is committed.
The script is idempotent: it creates the Supabase Auth user when absent and
ensures the linked profile has the `admin` role.

## Milestones

### Milestone 0 — Discovery and architecture

- [x] Inventory every entity rendered by the public website.
- [x] Confirm the current Next.js and Supabase conventions.
- [x] Define the deployment boundary and RBAC matrix.
- [x] Create the implementation branch.

Acceptance: the plan covers brands, rackets, variants, images, sellers, racket
offers/deals, strings, string offers, price history, guides, reviews, and staff.

### Milestone 1 — Standalone application foundation

- [x] Scaffold a current, standalone Next.js App Router project in `/admin`.
- [x] Add its own package manifest, lockfile, TypeScript, lint, and build scripts.
- [x] Add a responsive admin shell and design tokens.
- [x] Add and document a separate Vercel project/root-directory workflow.

Acceptance: `/admin` installs and builds independently; the repository root app
does not import admin code or dependencies.

### Milestone 2 — Authentication, RBAC, and audit foundation

- [x] Add manager support and staff-safe database policies.
- [x] Add request-bound Supabase server/admin clients and a session-refresh proxy.
- [x] Add sign-in, sign-out, protected DAL checks, and role-aware navigation.
- [x] Add idempotent initial-admin bootstrap and in-app staff management.
- [x] Record content and staff mutations in an audit log.

Acceptance: anonymous users cannot access admin data, managers cannot use staff
operations, and privileged credentials remain server-only.

### Milestone 3 — Catalogue operations

- [x] Manage brands.
- [x] Manage rackets and full technical/editorial details.
- [x] Manage racket variants.
- [x] Upload, reorder, promote, and remove racket gallery images.

Acceptance: an authorized staff member can create and maintain a complete racket
record that the public catalogue can render.

### Milestone 4 — Marketplace and editorial operations

- [x] Manage sellers and racket offers/deals.
- [x] Manage strings and string offers.
- [x] Manage racket and string price history.
- [x] Manage guides and moderate reviews.

Acceptance: every database-backed public-site content type has a discoverable
list, create/edit form, and guarded delete/moderation path.

### Milestone 5 — Operational dashboard and release hardening

- [x] Add inventory/status metrics, recent activity, search, pagination, and empty states.
- [x] Add loading/error/not-found states and accessible form feedback.
- [x] Verify typecheck, lint, production build, and the root application build.
- [x] Document environment variables, bootstrap, migration, and deployment steps.

Acceptance: the admin app has an independent production build and a repeatable
separate-Vercel-project runbook, with no regression to the public app build.

## Deployment boundary

In Vercel, create a second project from the same Git repository and set its Root
Directory to `admin`. Use `/admin`'s install and build commands. Configure the
admin project with the same Supabase URL/publishable key as the storefront plus
the service-role key used only for staff provisioning. The public-site Vercel
project remains rooted at the repository root and does not build `/admin`.
