const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const approved = [
  ['20261101130000_single_use_memberships', 'scripts/migrate-single-use-memberships.mjs'],
  ['20261103120000_direct_messages', 'scripts/migrate-direct-messages.mjs'],
  ['20261103160000_rich_direct_messages', 'scripts/migrate-rich-direct-messages.mjs']
];

/** Exact, ordered migration chain. Unknown schemas/SQL fail closed. No database work here. */
function selectAccountMigrations(root, previousSchema, targetSchema) {
  let current = hash(previousSchema);
  const target = hash(targetSchema);
  const steps = [];
  for (const [name, script] of approved) {
    if (current === target) break;
    const directory = path.join(root, 'prisma/migrations', name);
    const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
    if (plan.previousSchemaSha256 !== current) continue;
    if (plan.migrationSha256 !== hash(fs.readFileSync(path.join(directory, 'migration.sql'), 'utf8')) ||
      !/^[a-f0-9]{64}$/.test(plan.targetSchemaSha256) || !fs.existsSync(path.join(root, script))) {
      throw Error('Account migration checksum/script verification failed: ' + name);
    }
    steps.push({ name, script });
    current = plan.targetSchemaSha256;
  }
  if (current !== target) throw Error('Database schema changed without an exact approved migration plan');
  return steps;
}
module.exports = { selectAccountMigrations };
