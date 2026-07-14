// Household ownership and membership helpers. D1 remains authoritative;
// sessions only carry the Google identity used to resolve a membership.

const DEFAULT_HOUSEHOLD_ID = 'our-home';
const DEFAULT_HOUSEHOLD_NAME = 'Our Home';

export const HOUSEHOLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL,
  user_sub TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_sub),
  UNIQUE (user_sub),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_members_user_sub
  ON household_members(user_sub);
CREATE INDEX IF NOT EXISTS idx_household_members_household
  ON household_members(household_id, joined_at);
`;

export async function ensureHouseholdSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS household_members (
      household_id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      display_name TEXT NOT NULL,
      picture TEXT,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (household_id, user_sub),
      UNIQUE (user_sub),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_household_members_user_sub
      ON household_members(user_sub)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_household_members_household
      ON household_members(household_id, joined_at)`),
  ]);
}

let schemaPromise = null;
export function ensureHouseholdSchemaOnce(db) {
  if (!schemaPromise) {
    schemaPromise = ensureHouseholdSchema(db).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isHouseholdInvitee(email, roster) {
  const candidate = normalizeEmail(email);
  if (!candidate || typeof roster !== 'string') return false;
  return roster.split(',').some((entry) => normalizeEmail(entry) === candidate);
}

function householdConfig(env = {}) {
  return {
    id: String(env.HOUSEHOLD_ID || DEFAULT_HOUSEHOLD_ID).trim() || DEFAULT_HOUSEHOLD_ID,
    name: String(env.HOUSEHOLD_NAME || DEFAULT_HOUSEHOLD_NAME).trim() || DEFAULT_HOUSEHOLD_NAME,
  };
}

function displayName(auth) {
  const explicit = typeof auth?.name === 'string' ? auth.name.trim() : '';
  if (explicit) return explicit;
  const email = normalizeEmail(auth?.email);
  return email.includes('@') ? email.split('@')[0] : 'Cook';
}

function mapMembership(row) {
  if (!row) return null;
  return {
    household: { id: row.household_id, name: row.household_name },
    member: {
      id: row.user_sub,
      displayName: row.display_name,
      picture: row.picture || null,
      role: row.role,
    },
  };
}

export async function membershipForUser(db, userSub) {
  if (!userSub) return null;
  const row = await db.prepare(`
    SELECT
      m.household_id,
      m.user_sub,
      m.display_name,
      m.picture,
      m.role,
      m.joined_at,
      h.name AS household_name
    FROM household_members m
    JOIN households h ON h.id = m.household_id
    WHERE m.user_sub = ?
    LIMIT 1
  `).bind(userSub).first();
  return mapMembership(row);
}

export async function acceptHouseholdInvite(db, auth, env = {}, now = Date.now()) {
  if (!auth?.sub || !isHouseholdInvitee(auth.email, env.HOUSEHOLD_MEMBER_EMAILS)) {
    const error = new Error('Household invitation required');
    error.code = 'household_not_invited';
    throw error;
  }

  const existing = await membershipForUser(db, auth.sub);
  if (existing) return { created: false, membership: existing };

  const household = householdConfig(env);
  const owner = normalizeEmail(auth.email) === normalizeEmail(env.HOUSEHOLD_OWNER_EMAIL);
  const results = await db.batch([
    db.prepare(`
      INSERT INTO households (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(household.id, household.name, now, now),
    db.prepare(`
      INSERT INTO household_members
        (household_id, user_sub, display_name, picture, role, joined_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_sub) DO NOTHING
    `).bind(
      household.id,
      auth.sub,
      displayName(auth),
      typeof auth.picture === 'string' && auth.picture ? auth.picture : null,
      owner ? 'owner' : 'member',
      now,
    ),
  ]);

  const membership = await membershipForUser(db, auth.sub);
  if (!membership) throw new Error('Household membership was not persisted');
  return {
    created: Number(results?.[1]?.meta?.changes || 0) > 0,
    membership,
  };
}
