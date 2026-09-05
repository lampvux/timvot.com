import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_INITIAL_PASSWORD;
const displayName = process.env.ADMIN_INITIAL_NAME?.trim() || "Shuttlecraft Owner";

if (!url || !serviceRoleKey || !email || !password) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_INITIAL_EMAIL, and ADMIN_INITIAL_PASSWORD.",
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error("ADMIN_INITIAL_PASSWORD must contain at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail() {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function bootstrap() {
  let user = await findUserByEmail();
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user) throw error ?? new Error("Supabase did not create the owner account.");
    user = data.user;
    console.log(`Created initial owner account: ${email}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: { ...user.user_metadata, display_name: displayName },
    });
    if (error) throw error;
    console.log(`Updated initial owner credentials: ${email}`);
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
    display_name: displayName,
    role: "admin",
  });
  if (profileError) throw profileError;
  console.log("Initial owner profile is an administrator.");
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
