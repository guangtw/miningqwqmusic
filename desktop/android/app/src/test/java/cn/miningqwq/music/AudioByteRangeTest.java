package cn.miningqwq.music;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AudioByteRangeTest {
    @Test public void servesFullOpenEndedExplicitAndSuffixRanges() {
        assertArrayEquals(new long[]{0, 999}, AudioByteRange.bounds(null, 1000));
        assertArrayEquals(new long[]{200, 999}, AudioByteRange.bounds("bytes=200-", 1000));
        assertArrayEquals(new long[]{200, 499}, AudioByteRange.bounds("bytes=200-499", 1000));
        assertArrayEquals(new long[]{800, 999}, AudioByteRange.bounds("bytes=-200", 1000));
        assertArrayEquals(new long[]{999, 999}, AudioByteRange.bounds("bytes=999-1200", 1000));
    }

    @Test public void rejectsOutOfBoundsAndMultipleRanges() {
        assertNull(AudioByteRange.bounds("bytes=1000-", 1000));
        assertNull(AudioByteRange.bounds("bytes=300-299", 1000));
        assertNull(AudioByteRange.bounds("bytes=0-1,4-7", 1000));
        assertNull(AudioByteRange.bounds("bytes=-0", 1000));
        assertNull(AudioByteRange.bounds("bytes=9223372036854775808-", 1000));
    }

    @Test public void transferSourcesRequireTheOfficialHttpsCdn() {
        assertTrue(NativeOfflineAudio.trustedSource("https://m1.music.126.net/song.mp3"));
        assertFalse(NativeOfflineAudio.trustedSource("http://m1.music.126.net/song.mp3"));
        assertFalse(NativeOfflineAudio.trustedSource("https://m1.music.126.net.example.test/song.mp3"));
        assertFalse(NativeOfflineAudio.trustedSource("https://user@m1.music.126.net/song.mp3"));
        assertFalse(NativeOfflineAudio.trustedSource("https://m1.music.126.net:8888/song.mp3"));
    }

    @Test public void verifiesBytesBeforeAnOfflineFileMayBePromoted() throws Exception {
        byte[] correct = "abc".getBytes(StandardCharsets.UTF_8);
        byte[] wrong = "abd".getBytes(StandardCharsets.UTF_8);
        String md5 = "900150983cd24fb0d6963f7d28e17f72";
        ByteArrayOutputStream disk = new ByteArrayOutputStream();
        assertTrue(NativeOfflineAudio.copyVerified(new ByteArrayInputStream(correct), disk, 3, md5));
        assertArrayEquals(correct, disk.toByteArray());
        assertFalse(NativeOfflineAudio.copyVerified(new ByteArrayInputStream(wrong), disk, 3, md5));
        assertFalse(NativeOfflineAudio.copyVerified(new ByteArrayInputStream(correct), disk, 4, md5));
        assertFalse(NativeOfflineAudio.copyVerified(new ByteArrayInputStream(correct), disk, 2, md5));
    }
}
