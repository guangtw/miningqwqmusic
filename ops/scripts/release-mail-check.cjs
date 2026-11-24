const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const day = 24 * 60 * 60 * 1000;

function readReceipt(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function configurationKey(loginCommit, loginDir, mailFile) {
  const stat = fs.lstatSync(mailFile);
  if (!stat.isFile() || stat.size > 16384 || (process.platform !== 'win32' && (stat.mode & 0o077))) {
    throw Error('MAIL_CONFIGURATION_INVALID');
  }
  const inputs = [mailFile, ...['.env', '.env.production'].map(name => path.join(loginDir, name))];
  const hashes = inputs.map(file => fs.existsSync(file)
    ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
  return crypto.createHash('sha256').update(JSON.stringify([loginCommit, ...hashes])).digest('hex');
}

function probe(node, loginDir) {
  const result = spawnSync(node, ['scripts/mail-channel.mjs', '--verify'], {
    cwd: loginDir, encoding: 'utf8', timeout: 35000, maxBuffer: 16384
  });
  if (result.error || result.signal) throw Error('SMTP_PROBE_FAILED');
  let reply;
  try { reply = JSON.parse(result.status === 0 ? result.stdout : result.stderr); }
  catch { throw Error('SMTP_PROBE_FAILED'); }
  if (result.status === 0 && reply?.ok === true && reply.verified === true) return true;
  if (result.status === 1 && reply?.ok === false && reply.code === 'MAIL_AUTHENTICATION_FAILED') return false;
  throw Error('SMTP_PROBE_FAILED');
}

async function checkReleaseMail({ loginCommit, loginDir, mailFile, receiptFile, verify, wait = delay }) {
  const previous = readReceipt(receiptFile);
  if (!fs.existsSync(mailFile) && !previous) return 'unconfigured';
  const key = configurationKey(loginCommit, loginDir, mailFile);
  const age = previous?.key === key ? Date.now() - previous.verifiedAt : Infinity;
  if (age >= 0 && age < day) return 'cached';
  let verified = verify();
  if (!verified) {
    await wait(15000);
    verified = verify();
  }
  if (configurationKey(loginCommit, loginDir, mailFile) !== key) throw Error('SMTP_CONFIGURATION_CHANGED_DURING_CHECK');
  if (!verified) {
    if (age >= 0 && age < 7 * day) return 'auth-warning';
    throw Error('MAIL_AUTHENTICATION_FAILED');
  }
  fs.writeFileSync(receiptFile + '.tmp', JSON.stringify({ key, verifiedAt: Date.now() }), { mode: 0o600 });
  fs.renameSync(receiptFile + '.tmp', receiptFile);
  return 'verified';
}

module.exports = { checkReleaseMail, probe };
