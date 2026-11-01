// Only migrate the known obsolete preset. Custom upstream providers stay intact.
function normalizeLegacyUnblockSources(env) {
  return env.replace(/^MUSIC_SOURCE_UNBLOCK_SOURCES=([^\r\n]*)/m, (line, value) => {
    const sources = value.trim().replace(/^(["'])(.*)\1$/, '$2').split(',').map(source => source.trim());
    return sources.join(',') === 'kuwo,kugou,migu' ? 'MUSIC_SOURCE_UNBLOCK_SOURCES=unm,msls,qijieya' : line;
  });
}
module.exports = { normalizeLegacyUnblockSources };
