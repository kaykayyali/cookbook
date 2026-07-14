export function householdDb() {
  const households = new Map();
  const members = new Map();
  const calls = [];

  function statement(sql) {
    const stmt = {
      sql,
      values: [],
      bind(...values) { stmt.values = values; return stmt; },
      async first() {
        calls.push({ op: 'first', sql, values: stmt.values });
        if (!/FROM household_members/i.test(sql)) return null;
        const member = members.get(stmt.values[0]);
        if (!member) return null;
        const household = households.get(member.household_id);
        return household ? { ...member, household_name: household.name } : null;
      },
      async run() {
        calls.push({ op: 'run', sql, values: stmt.values });
        if (/INSERT INTO households/i.test(sql)) {
          const [id, name, createdAt, updatedAt] = stmt.values;
          const existing = households.get(id);
          households.set(id, existing || { id, name, created_at: createdAt, updated_at: updatedAt });
          return { meta: { changes: existing ? 0 : 1 } };
        }
        if (/INSERT INTO household_members/i.test(sql)) {
          const [householdId, userSub, displayName, picture, role, joinedAt] = stmt.values;
          const existing = members.get(userSub);
          if (!existing) members.set(userSub, {
            household_id: householdId,
            user_sub: userSub,
            display_name: displayName,
            picture,
            role,
            joined_at: joinedAt,
          });
          return { meta: { changes: existing ? 0 : 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  }

  return {
    db: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => Promise.all(statements.map((stmt) => stmt.run())),
    },
    households,
    members,
    calls,
  };
}
