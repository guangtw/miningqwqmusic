"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrackDetail, getTrackInsight, getTrackLyric, getTrackPlaySource } from "@/src/lib/client-api";
import { locateCurrentLyricIndex } from "@/src/lib/lyrics";
import { pickCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import type { LyricLine, PlaySource, PlaybackMode, Track } from "@/src/types/music";

type TransitionPhase = "idle" | "fadingOut" | "switching" | "fadingIn";

type CachedPlaySource = {
  source: PlaySource;
  cachedAt: number;
};

type CachedAudioBlob = {
  trackId: string;
  sourceUrl: string;
  blobUrl: string;
  size: number;
  cachedAt: number;
};

type ControllerState = {
  currentTrack: Track | null;
  currentSource: PlaySource | null;
  lyricLines: LyricLine[];
  lyricTranslatedLines: LyricLine[];
  lyricKaraokeLines: LyricLine[];
  lyricIndex: number;
  errorText: string | null;
  loadingSource: boolean;
  transitionPhase: TransitionPhase;
  audioRef: { current: HTMLAudioElement | null };
  seekTo: (ms: number) => void;
};

const CROSSFADE_MS = 350;
const PREFETCH_EXPIRE_BUFFER_MS = 8000;
const FULL_AUDIO_CACHE_LIMIT = 3;
const RECOVERY_COOLDOWN_MS = 1200;
const RECOVERY_WINDOW_MS = 25000;
const RECOVERY_MAX_ATTEMPTS = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function selectPrefetchTarget(queue: Track[], currentIndex: number, mode: PlaybackMode): Track | null {
  if (!queue.length || currentIndex < 0 || currentIndex >= queue.length) return null;
  if (mode === "loop-one") return null;
  if (mode === "shuffle") {
    return queue.find((_, index) => index !== currentIndex) ?? null;
  }
  const nextIndex = (currentIndex + 1) % queue.length;
  return queue[nextIndex] ?? null;
}

function isCachedSourceUsable(entry?: CachedPlaySource): boolean {
  if (!entry) return false;
  const ttlMs = entry.source.ttlSeconds ? entry.source.ttlSeconds * 1000 : 0;
  if (ttlMs <= 0) return true;
  return Date.now() - entry.cachedAt < Math.max(1000, ttlMs - PREFETCH_EXPIRE_BUFFER_MS);
}

export function usePlayerController(): ControllerState {
  const audioRef = useRef<HTMLAudioElement>(null);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const mode = usePlayerStore((state) => state.mode);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const volume = usePlayerStore((state) => state.volume);
  const currentTimeMs = usePlayerStore((state) => state.currentTimeMs);
  const setCurrentTimeMs = usePlayerStore((state) => state.setCurrentTimeMs);
  const setDurationMs = usePlayerStore((state) => state.setDurationMs);
  const nextTrack = usePlayerStore((state) => state.nextTrack);
  const rememberTrack = usePlayerStore((state) => state.rememberTrack);
  const playTrackNow = usePlayerStore((state) => state.playTrackNow);

  const queueTrack = useMemo(() => pickCurrentTrack(queue, currentIndex), [queue, currentIndex]);
  const currentTrackId = queueTrack?.id ?? null;
  const [source, setSource] = useState<PlaySource | null>(null);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricTranslatedLines, setLyricTranslatedLines] = useState<LyricLine[]>([]);
  const [lyricKaraokeLines, setLyricKaraokeLines] = useState<LyricLine[]>([]);
  const [resolvedTrack, setResolvedTrack] = useState<Track | null>(queueTrack);
  const [loadingSource, setLoadingSource] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");

  const renewTimerRef = useRef<number | null>(null);
  const transitionTokenRef = useRef(0);
  const prefetchedSourceRef = useRef<Map<string, CachedPlaySource>>(new Map());
  const fullAudioCacheRef = useRef<Map<string, CachedAudioBlob>>(new Map());
  const fullAudioFetchControllerRef = useRef<Map<string, AbortController>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());
  const recoveryRef = useRef<{ attempts: number; windowStartedAt: number; lastRecoverAt: number }>({
    attempts: 0,
    windowStartedAt: 0,
    lastRecoverAt: 0
  });
  const resumeAfterSourceSwitchRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);
  const currentSourceRef = useRef<PlaySource | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    currentSourceRef.current = source;
  }, [source]);

  useEffect(() => {
    recoveryRef.current = {
      attempts: 0,
      windowStartedAt: Date.now(),
      lastRecoverAt: 0
    };
    resumeAfterSourceSwitchRef.current = null;
  }, [currentTrackId]);

  const applyGain = useCallback((nextVolume: number, smoothMs = 80) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.min(1, Math.max(0, nextVolume));
    if (smoothMs <= 0) {
      audio.volume = target;
      return;
    }
    const from = Math.min(1, Math.max(0, audio.volume));
    const steps = Math.max(2, Math.min(12, Math.round(smoothMs / 28)));
    for (let step = 1; step <= steps; step += 1) {
      window.setTimeout(() => {
        if (!audioRef.current || audioRef.current !== audio) return;
        const ratio = step / steps;
        audio.volume = from + (target - from) * ratio;
      }, Math.round((smoothMs / steps) * step));
    }
  }, []);

  const fadeOutAudio = useCallback(async (token: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const hasCurrentSource = Boolean(currentSourceRef.current?.url || audio.currentSrc || audio.src);
    const shouldFade = isPlayingRef.current && !audio.paused && hasCurrentSource;
    if (!shouldFade) {
      audio.pause();
      return;
    }

    audio.volume = Math.min(1, Math.max(0, volumeRef.current));
    const from = audio.volume;
    const steps = 8;
    for (let step = 1; step <= steps; step += 1) {
      if (token !== transitionTokenRef.current) return;
      const ratio = step / steps;
      audio.volume = from * (1 - ratio);
      await wait(Math.round(CROSSFADE_MS / steps));
    }
    if (token !== transitionTokenRef.current) return;
    audio.pause();
  }, []);

  const fadeInAudio = useCallback(async (token: number) => {
    const audio = audioRef.current;
    if (!audio || token !== transitionTokenRef.current) return;
    const targetVolume = volumeRef.current;

    audio.volume = 0;
    const steps = 8;
    for (let index = 1; index <= steps; index += 1) {
      if (token !== transitionTokenRef.current) return;
      audio.volume = Math.min(1, (targetVolume * index) / steps);
      await wait(Math.round(CROSSFADE_MS / steps));
    }
  }, []);

  const revokeCachedBlob = useCallback((trackId: string) => {
    const cached = fullAudioCacheRef.current.get(trackId);
    if (!cached) return;
    URL.revokeObjectURL(cached.blobUrl);
    fullAudioCacheRef.current.delete(trackId);
  }, []);

  const ensureAudioCacheLimit = useCallback((keepTrackId?: string) => {
    const entries = Array.from(fullAudioCacheRef.current.values()).sort((a, b) => b.cachedAt - a.cachedAt);
    const keptTrackId = keepTrackId ?? currentTrackId ?? undefined;
    let keptCount = 0;
    for (const entry of entries) {
      if (keptTrackId && entry.trackId === keptTrackId) {
        continue;
      }
      if (keptCount < FULL_AUDIO_CACHE_LIMIT - 1) {
        keptCount += 1;
        continue;
      }
      revokeCachedBlob(entry.trackId);
    }
  }, [currentTrackId, revokeCachedBlob]);

  const cacheTrackAudioBlob = useCallback(async (trackId: string, sourceUrl: string) => {
    if (!sourceUrl) return;
    const existing = fullAudioCacheRef.current.get(trackId);
    if (existing?.sourceUrl === sourceUrl) return;
    const previousController = fullAudioFetchControllerRef.current.get(trackId);
    if (previousController) {
      previousController.abort();
    }

    const controller = new AbortController();
    fullAudioFetchControllerRef.current.set(trackId, controller);
    try {
      const response = await fetch(sourceUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) return;
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      const previous = fullAudioCacheRef.current.get(trackId);
      if (previous) {
        URL.revokeObjectURL(previous.blobUrl);
      }
      fullAudioCacheRef.current.set(trackId, {
        trackId,
        sourceUrl,
        blobUrl,
        size: blob.size,
        cachedAt: Date.now()
      });
      ensureAudioCacheLimit(trackId);
    } catch {
      // 缓存失败不影响主播放链路。
    } finally {
      const activeController = fullAudioFetchControllerRef.current.get(trackId);
      if (activeController === controller) {
        fullAudioFetchControllerRef.current.delete(trackId);
      }
    }
  }, [ensureAudioCacheLimit]);

  useEffect(() => {
    if (!queueTrack) {
      setResolvedTrack(null);
      return;
    }

    setResolvedTrack(queueTrack);
    if (queueTrack.coverUrl) {
      return;
    }

    let active = true;
    getTrackDetail(queueTrack.id)
      .then((detailTrack) => {
        if (!active) return;
        setResolvedTrack((current) => {
          if (!current || current.id !== detailTrack.id) {
            return current;
          }
          return {
            ...current,
            ...detailTrack,
            album: detailTrack.album ?? current.album,
            coverUrl: detailTrack.coverUrl ?? current.coverUrl
          };
        });
      })
      .catch(() => {
        // 详情接口失败时保持当前曲目信息，避免影响播放流程。
      });

    return () => {
      active = false;
    };
  }, [queueTrack?.id, queueTrack?.coverUrl, queueTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!queueTrack) {
      transitionTokenRef.current += 1;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setSource(null);
      setLyricLines([]);
      setLyricTranslatedLines([]);
      setLyricKaraokeLines([]);
      setCurrentTimeMs(0);
      setDurationMs(0);
      setTransitionPhase("idle");
      applyGain(volumeRef.current, 30);
      return;
    }

    let active = true;
    const token = ++transitionTokenRef.current;

    const run = async () => {
      setErrorText(null);
      setLoadingSource(true);

      const cachedAudio = fullAudioCacheRef.current.get(queueTrack.id);
      const cached = prefetchedSourceRef.current.get(queueTrack.id);
      const validCached = isCachedSourceUsable(cached);
      const playSourcePromise = cachedAudio
        ? Promise.resolve<PlaySource>({
            trackId: queueTrack.id,
            url: cachedAudio.blobUrl
          })
        : validCached && cached
          ? Promise.resolve(cached.source)
          : getTrackPlaySource(queueTrack.id);

      setTransitionPhase("fadingOut");
      await fadeOutAudio(token);
      if (!active || token !== transitionTokenRef.current) return;

      setTransitionPhase("switching");
      setSource(null);
      setLyricLines([]);
      setLyricTranslatedLines([]);
      setLyricKaraokeLines([]);
      setCurrentTimeMs(0);
      setDurationMs(0);
      rememberTrack(queueTrack);

      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      try {
        const playSource = await playSourcePromise;
        if (!active || token !== transitionTokenRef.current) return;
        setSource(playSource);
        if (!playSource.url.startsWith("blob:")) {
          prefetchedSourceRef.current.set(queueTrack.id, { source: playSource, cachedAt: Date.now() });
        }
      } catch (error) {
        if (!active || token !== transitionTokenRef.current) return;
        const errorMessage = (error as Error).message || "播放地址获取失败";
        try {
          const insight = await getTrackInsight(queueTrack.id);
          const fallbackTrack = insight.alternatives.find((item) => item.id && item.id !== queueTrack.id);
          if (fallbackTrack) {
            setErrorText(`当前歌曲受限，已切换到可播放版本：${fallbackTrack.name}`);
            playTrackNow(fallbackTrack);
            return;
          }
        } catch {
          // 替代推荐不可用时保留原错误。
        }
        setErrorText(errorMessage);
      } finally {
        if (active && token === transitionTokenRef.current) {
          setLoadingSource(false);
        }
      }

      getTrackLyric(queueTrack.id)
        .then((lyric) => {
          if (!active || token !== transitionTokenRef.current) return;
          setLyricLines(lyric.lines);
          setLyricTranslatedLines(lyric.translatedLines ?? []);
          setLyricKaraokeLines(lyric.karaokeLines ?? []);
        })
        .catch(() => {
          if (!active || token !== transitionTokenRef.current) return;
          setLyricLines([]);
          setLyricTranslatedLines([]);
          setLyricKaraokeLines([]);
        });
    };

    void run();
    return () => {
      active = false;
    };
  }, [queueTrack, currentTrackId, playTrackNow, rememberTrack, setCurrentTimeMs, setDurationMs, applyGain, fadeOutAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sourceReady = Boolean(source?.url && currentTrackId && source.trackId === currentTrackId);

    if (!sourceReady || !source) {
      audio.pause();
      setTransitionPhase((previous) => (previous === "idle" ? "idle" : "switching"));
      return;
    }

    if (audio.src !== source.url) {
      audio.pause();
      const resumeMs = resumeAfterSourceSwitchRef.current;
      if (typeof resumeMs === "number" && resumeMs >= 0) {
        const onLoaded = () => {
          const maxSecond = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.24) : Number.MAX_SAFE_INTEGER;
          const targetSecond = Math.max(0, Math.min(resumeMs / 1000, maxSecond));
          audio.currentTime = targetSecond;
          setCurrentTimeMs(Math.floor(targetSecond * 1000));
          resumeAfterSourceSwitchRef.current = null;
        };
        audio.addEventListener("loadedmetadata", onLoaded, { once: true });
      }
      audio.src = source.url;
      audio.load();
    }

    if (!isPlaying) {
      audio.pause();
      applyGain(volume, 50);
      setTransitionPhase("idle");
      return;
    }

    const token = transitionTokenRef.current;
    const run = async () => {
      setTransitionPhase("fadingIn");
      audio.volume = 0;
      audio.muted = false;
      await audio.play();
      await fadeInAudio(token);
      if (token === transitionTokenRef.current) {
        setTransitionPhase("idle");
      }
    };

    void run().catch(() => {
      setErrorText("浏览器阻止了自动播放，请手动点击播放");
      setTransitionPhase("idle");
    });
  }, [source, source?.url, source?.trackId, isPlaying, currentTrackId, volume, applyGain, fadeInAudio, setCurrentTimeMs]);

  useEffect(() => {
    if (transitionPhase === "fadingIn" || transitionPhase === "fadingOut") return;
    applyGain(volume, 70);
  }, [volume, transitionPhase, applyGain]);

  useEffect(() => {
    if (!currentTrackId || !source?.url) return;
    if (source.url.startsWith("blob:")) return;
    void cacheTrackAudioBlob(currentTrackId, source.url);
  }, [cacheTrackAudioBlob, currentTrackId, source?.url]);

  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const resetRecoveryWindow = () => {
      recoveryRef.current = {
        attempts: 0,
        windowStartedAt: Date.now(),
        lastRecoverAt: recoveryRef.current.lastRecoverAt
      };
    };

    const recoverPlayback = async (reason: "waiting" | "stalled" | "suspend" | "error") => {
      if (!queueTrack) return;
      const currentAudio = audioRef.current;
      if (!currentAudio) return;

      const now = Date.now();
      const snapshot = recoveryRef.current;
      if (now - snapshot.lastRecoverAt < RECOVERY_COOLDOWN_MS) return;
      if (!snapshot.windowStartedAt || now - snapshot.windowStartedAt > RECOVERY_WINDOW_MS) {
        recoveryRef.current.windowStartedAt = now;
        recoveryRef.current.attempts = 0;
      }
      recoveryRef.current.lastRecoverAt = now;
      recoveryRef.current.attempts += 1;
      if (recoveryRef.current.attempts > RECOVERY_MAX_ATTEMPTS) {
        setErrorText("网络不稳定，已多次尝试恢复播放");
        return;
      }

      const resumeMs = Math.floor(currentAudio.currentTime * 1000);
      const cachedAudio = fullAudioCacheRef.current.get(queueTrack.id);
      if (cachedAudio && currentAudio.src !== cachedAudio.blobUrl) {
        resumeAfterSourceSwitchRef.current = resumeMs;
        setSource({
          trackId: queueTrack.id,
          url: cachedAudio.blobUrl,
          bitrate: currentSourceRef.current?.bitrate
        });
        setErrorText("网络波动，已切换缓存继续播放");
        return;
      }

      try {
        const renewed = await getTrackPlaySource(queueTrack.id);
        prefetchedSourceRef.current.set(queueTrack.id, { source: renewed, cachedAt: Date.now() });
        resumeAfterSourceSwitchRef.current = resumeMs;
        setSource(renewed);
        void cacheTrackAudioBlob(queueTrack.id, renewed.url);
        setErrorText(reason === "error" ? "播放链路已刷新" : "网络波动，已刷新播放链路");
      } catch (error) {
        const message = (error as Error).message || "音频播放失败";
        try {
          const insight = await getTrackInsight(queueTrack.id);
          const fallbackTrack = insight.alternatives.find((item) => item.id && item.id !== queueTrack.id);
          if (fallbackTrack) {
            setErrorText(`当前歌曲受限，已切换到可播放版本：${fallbackTrack.name}`);
            playTrackNow(fallbackTrack);
            return;
          }
        } catch {
          // 忽略替代推荐失败。
        }
        setErrorText(message);
      }
    };

    const onTimeUpdate = () => {
      setCurrentTimeMs(Math.floor(audio.currentTime * 1000));
    };
    const onLoadedMetadata = () => {
      setDurationMs(Math.floor(audio.duration * 1000) || 0);
    };
    const onEnded = () => {
      resetRecoveryWindow();
      nextTrack();
    };
    const onError = () => {
      void recoverPlayback("error");
    };
    const onPlaying = () => {
      resetRecoveryWindow();
    };
    const onWaiting = () => {
      if (!isPlayingRef.current || audio.paused || audio.ended) return;
      void recoverPlayback("waiting");
    };
    const onStalled = () => {
      if (!isPlayingRef.current || audio.paused || audio.ended) return;
      void recoverPlayback("stalled");
    };
    const onSuspend = () => {
      if (!isPlayingRef.current || audio.paused || audio.ended) return;
      if (audio.readyState >= 3) return;
      void recoverPlayback("suspend");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
      audio.removeEventListener("error", onError);
    };
  }, [cacheTrackAudioBlob, queueTrack, currentTrackId, nextTrack, playTrackNow, setCurrentTimeMs, setDurationMs]);

  useEffect(() => {
    if (renewTimerRef.current) {
      window.clearTimeout(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    if (!source || !queueTrack) return;

    const ttlMs = source.ttlSeconds ? source.ttlSeconds * 1000 : 0;
    if (ttlMs <= 0) return;

    const renewAt = Math.max(1000, ttlMs - 5000);
    renewTimerRef.current = window.setTimeout(async () => {
      try {
        const renewed = await getTrackPlaySource(queueTrack.id);
        prefetchedSourceRef.current.set(queueTrack.id, { source: renewed, cachedAt: Date.now() });
        if (source?.trackId === queueTrack.id && source?.url === renewed.url) {
          setSource((previous) => {
            if (!previous || previous.trackId !== renewed.trackId) return previous;
            return {
              ...previous,
              ttlSeconds: renewed.ttlSeconds,
              expiresAt: renewed.expiresAt,
              bitrate: renewed.bitrate
            };
          });
        }
      } catch {
        setErrorText("播放链接续签失败，可能会中断播放");
      }
    }, renewAt);

    return () => {
      if (renewTimerRef.current) {
        window.clearTimeout(renewTimerRef.current);
      }
    };
  }, [source, queueTrack, currentTrackId]);

  useEffect(() => {
    const target = selectPrefetchTarget(queue, currentIndex, mode);
    if (!target) return;
    if (prefetchingRef.current.has(target.id)) return;
    if (isCachedSourceUsable(prefetchedSourceRef.current.get(target.id))) return;

    prefetchingRef.current.add(target.id);
    getTrackPlaySource(target.id)
      .then((playSource) => {
        prefetchedSourceRef.current.set(target.id, { source: playSource, cachedAt: Date.now() });
      })
      .catch(() => {
        // 预加载失败不影响主播放链路。
      })
      .finally(() => {
        prefetchingRef.current.delete(target.id);
      });
  }, [queue, currentIndex, mode, currentTrackId]);

  useEffect(() => {
    const fetchControllerMap = fullAudioFetchControllerRef.current;
    const audioCacheMap = fullAudioCacheRef.current;
    return () => {
      fetchControllerMap.forEach((controller) => controller.abort());
      fetchControllerMap.clear();
      audioCacheMap.forEach((entry) => {
        URL.revokeObjectURL(entry.blobUrl);
      });
      audioCacheMap.clear();
    };
  }, []);

  const lyricIndex = useMemo(() => locateCurrentLyricIndex(lyricLines, currentTimeMs), [lyricLines, currentTimeMs]);

  return {
    currentTrack: resolvedTrack,
    currentSource: source,
    lyricLines,
    lyricTranslatedLines,
    lyricKaraokeLines,
    lyricIndex,
    errorText,
    loadingSource,
    transitionPhase,
    audioRef,
    seekTo: (ms: number) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = ms / 1000;
      setCurrentTimeMs(ms);
    }
  };
}
