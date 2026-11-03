// Only migrate the known obsolete preset. Custom upstream providers stay intact.
function normalizeLegacyUnblockSources(env) {
  return env.replace(/^MUSIC_SOURCE_UNBLOCK_SOURCES=([^\r\n]*)/m, (line, value) => {
    const sources = value.trim().replace(/^(["'])(.*)\1$/, '$2').split(',').map(source => source.trim());
    return sources.join(',') === 'kuwo,kugou,migu' ? 'MUSIC_SOURCE_UNBLOCK_SOURCES=unm,msls,qijieya' : line;
  });
}
function setEnvValues(env, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw Error('Invalid environment setting');
    const pattern = new RegExp('^' + key + '=.*$', 'mg');
    env = pattern.test(env) ? env.replace(pattern, () => key + '=' + value) : env.replace(/\s*$/, '') + '\n' + key + '=' + value + '\n';
  }
  return env;
}
module.exports = { normalizeLegacyUnblockSources, setEnvValues };
