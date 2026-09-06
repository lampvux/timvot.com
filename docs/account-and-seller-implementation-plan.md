# Account and seller onboarding implementation plan

- [x] Create and switch to the feature branch.
- [x] Audit the existing Supabase auth, account navigation, profile data, seller flow, and admin review model.
- [x] Add registration confirmation-password validation and a resend-verification-email flow for existing unverified accounts.
- [x] Add a login "remember me" option backed by a secure cookie/session persistence policy.
- [x] Replace the signed-in account navigation action with an accessible dropdown containing profile, seller, and logout actions.
- [x] Build a profile page where signed-in users can update their account profile.
- [x] Build seller application storage, validation, and row-level access rules.
- [x] Add the seller registration form and pending/approved/rejected states, and prevent unapproved sellers from listing.
- [x] Add an admin review workflow for seller applications.
- [x] Update localized copy and project documentation as needed.
- [x] Run type checks, automated tests, production builds, and targeted browser verification; fix regressions.

## Notes

- Keep Supabase credentials and authentication tokens out of client-readable custom cookies.
- Use the existing Next.js 16 and Supabase SSR patterns already present in the repository.
- Mark each item complete only after its implementation is verified.
