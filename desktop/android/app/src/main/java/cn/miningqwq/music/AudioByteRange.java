package cn.miningqwq.music;

/** Inclusive bounds for one HTTP audio range. Multiple ranges are intentionally unsupported. */
final class AudioByteRange {
    private AudioByteRange() {}

    static long[] bounds(String range, long length) {
        if (length < 1) return null;
        if (range == null) return new long[]{0, length - 1};
        if (!range.matches("bytes=[0-9]*-[0-9]*")) return null;
        int separator = range.indexOf('-', 6);
        String from = range.substring(6, separator);
        String to = range.substring(separator + 1);
        try {
            if (from.isEmpty()) {
                long suffix = Long.parseLong(to);
                return suffix > 0 ? new long[]{Math.max(0, length - suffix), length - 1} : null;
            }
            long start = Long.parseLong(from);
            long end = to.isEmpty() ? length - 1 : Math.min(Long.parseLong(to), length - 1);
            return start <= end ? new long[]{start, end} : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }
}
