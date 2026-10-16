/**
 * Create (or promote) the owner/administrator account — no credentials are hard-coded.
 *
 *   npm run admin:create -- --email owner@example.com --name "Jane Owner" [--team surette] [--team-name "Surette Real Estate"]
 *
 * The password is read from ADMIN_PASSWORD or prompted (hidden). Creates the team row if it
 * doesn't exist yet. Re-running for an existing email resets that user's password and role.
 */
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";
import { getPool, withSystemDb } from "../src/lib/server/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => (muted ? out.output.write("*") : out.output.write(s));
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const slug = arg("team") ?? process.env.SITE_TEAM_SLUG ?? "surette";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error('Usage: npm run admin:create -- --email you@example.com --name "Your Name"');
  const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (min 12 chars, letters + numbers): "));
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("Password must be at least 12 characters with letters and numbers.");
  const hash = await bcrypt.hash(password, 12);
  await withSystemDb(async (db) => {
    let team = await db.one<{ id: string }>("SELECT id FROM agent_teams WHERE slug = $1", [slug]);
    if (!team) {
      team = await db.one<{ id: string }>("INSERT INTO agent_teams (slug, name, market) VALUES ($1, $2, $3) RETURNING id", [slug, arg("team-name") ?? "Surette Real Estate", arg("market") ?? "Central Maine"]);
      console.log(`Created team "${slug}".`);
    }
    const user = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, title, is_active)
       VALUES ($1, $2, $3, 'admin', $4, 'Owner', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', team_id = EXCLUDED.team_id, is_active = true, failed_logins = 0, locked_until = NULL
       RETURNING id`,
      [email, hash, name, team!.id],
    );
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id) VALUES ($1, NULL, 'admin.created_via_cli', 'user', $2)", [team!.id, user!.id]);
  });
  console.log(`✓ ${email} can now sign in at /portal/sign-in as owner/administrator.`);
}

main()
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await getPool().end();
    process.exit(1);
  });
