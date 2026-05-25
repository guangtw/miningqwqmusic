"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrackDetail, getTrackInsight, getTrackLyric, getTrackPlaySource } from "@/src/lib/client-api";
import { locateCurrentLyricIndex } from "@/src/lib/lyrics";
import {
  canStartRecovery,
  isSessionValid,
  shouldReloadTrack,
  shouldReplaceAudioSource,
  shouldStartPlayback
} from "@/src/lib/playback-guard";
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
  const currentTrackIdRef = useRef<string | null>(currentTrackId);
  const queueTrackRef = useRef<Track | null>(queueTrack);
  const appliedTrackIdRef = useRef<string | null>(null);
  const appliedSourceUrlRef = useRef<string | null>(null);
  const transitionPhaseRef = useRef<TransitionPhase>("idle");
  const playbackSessionRef = useRef(0);
  const lastLoadedTrackIdRef = useRef<string | null>(null);
  const recoveryInFlightRef = useRef(false);
  const lastEndedAtRef = useRef(0);

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
    currentTrackIdRef.current = currentTrackId;
  }, [currentTrackId]);

  useEffect(() => {
    queueTrackRef.current = queueTrack;
  }, [queueTrack]);

  useEffect(() => {
    transitionPhaseRef.current = transitionPhase;
  }, [transitionPhase]);

  useEffect(() => {
    recoveryRef.current = {
      attempts: 0,
      windowStartedAt: Date.now(),
      lastRecoverAt: 0
    };
    resumeAfterSourceSwitchRef.current = null;
    recoveryInFlightRef.current = false;
    lastEndedAtRef.current = 0;
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
    const nextTrackId = currentTrackId;
    if (!nextTrackId) {
      lastLoadedTrackIdRef.current = null;
      transitionTokenRef.current += 1;
      playbackSessionRef.current += 1;
      appliedTrackIdRef.current = null;
      appliedSourceUrlRef.current = null;
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
    if (!shouldReloadTrack(lastLoadedTrackIdRef.current, nextTrackId)) {
      return;
    }
    lastLoadedTrackIdRef.current = nextTrackId;

    let active = true;
    const token = ++transitionTokenRef.current;
    const sessionId = playbackSessionRef.current + 1;
    playbackSessionRef.current = sessionId;
    const sessionSnapshot = {
      sessionId,
      trackId: nextTrackId,
      token
    };
    const isActiveSession = () =>
      active &&
      isSessionValid(
        sessionSnapshot,
        playbackSessionRef.current,
        currentTrackIdRef.current,
        transitionTokenRef.current
      );

    const run = async () => {
      setErrorText(null);
      setLoadingSource(true);

      const cachedAudio = fullAudioCacheRef.current.get(nextTrackId);
      const cached = prefetchedSourceRef.current.get(nextTrackId);
      const validCached = isCachedSourceUsable(cached);
      const playSourcePromise = cachedAudio
        ? Promise.resolve<PlaySource>({
            trackId: nextTrackId,
            url: cachedAudio.blobUrl
          })
        : validCached && cached
          ? Promise.resolve(cached.source)
          : getTrackPlaySource(nextTrackId);

      setTransitionPhase("fadingOut");
      await fadeOutAudio(token);
      if (!isActiveSession()) return;

      setTransitionPhase("switching");
      setSource(null);
      setLyricLines([]);
      setLyricTranslatedLines([]);
      setLyricKaraokeLines([]);
      setCurrentTimeMs(0);
      setDurationMs(0);
      const trackForRemember = queueTrackRef.current;
      if (trackForRemember && trackForRemember.id === nextTrackId) {
        rememberTrack(trackForRemember);
      }

      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        appliedTrackIdRef.current = null;
        appliedSourceUrlRef.current = null;
      }

      try {
        const playSource = await playSourcePromise;
        if (!isActiveSession()) return;
        setSource(playSource);
        if (!playSource.url.startsWith("blob:")) {
          prefetchedSourceRef.current.set(nextTrackId, { source: playSource, cachedAt: Date.now() });
        }
      } catch (error) {
        if (!isActiveSession()) return;
        const errorMessage = (error as Error).message || "播放地址获取失败";
        try {
          const insight = await getTrackInsight(nextTrackId);
          if (!isActiveSession()) return;
          const fallbackTrack = insight.alternatives.find((item) => item.id && item.id !== nextTrackId);
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
        if (isActiveSession()) {
          setLoadingSource(false);
        }
      }

      getTrackLyric(nextTrackId)
        .then((lyric) => {
          if (!isActiveSession()) return;
          setLyricLines(lyric.lines);
          setLyricTranslatedLines(lyric.translatedLines ?? []);
          setLyricKaraokeLines(lyric.karaokeLines ?? []);
        })
        .catch(() => {
          if (!isActiveSession()) return;
          setLyricLines([]);
          setLyricTranslatedLines([]);
          setLyricKaraokeLines([]);
        });
    };

    void run();
    return () => {
      active = false;
    };
  }, [currentTrackId, playTrackNow, rememberTrack, setCurrentTimeMs, setDurationMs, applyGain, fadeOutAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sourceReady = Boolean(source?.url && currentTrackId && source.trackId === currentTrackId);
    const sourceTrackId = source?.trackId ?? null;
    const sourceUrl = source?.url ?? null;
    const sessionSnapshot = {
      sessionId: playbackSessionRef.current,
      trackId: currentTrackId,
      token: transitionTokenRef.current
    };
    const isCurrentSession = () =>
      isSessionValid(
        sessionSnapshot,
        playbackSessionRef.current,
        currentTrackIdRef.current,
        transitionTokenRef.current
      );
    const hardClearAudio = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      appliedTrackIdRef.current = null;
      appliedSourceUrlRef.current = null;
    };

    if (!sourceReady || !source) {
      if (appliedTrackIdRef.current && appliedTrackIdRef.current !== currentTrackId) {
        hardClearAudio();
      } else {
        audio.pause();
      }
      setTransitionPhase((previous) => (previous === "idle" ? "idle" : "switching"));
      return;
    }

    const sourceChangedByIdentity = shouldReplaceAudioSource({
      appliedTrackId: appliedTrackIdRef.current,
      appliedSourceUrl: appliedSourceUrlRef.current,
      nextTrackId: sourceTrackId,
      nextSourceUrl: sourceUrl
    });
    const domBoundToNextSource = sourceUrl ? (audio.currentSrc || audio.src) === sourceUrl : false;
    const sourceChanged = sourceChangedByIdentity || !domBoundToNextSource;

    if (sourceChanged && sourceUrl) {
      hardClearAudio();
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
      audio.src = sourceUrl;
      audio.load();
      appliedTrackIdRef.current = sourceTrackId;
      appliedSourceUrlRef.current = sourceUrl;
    } else if (!sourceChanged) {
      appliedTrackIdRef.current = sourceTrackId;
      appliedSourceUrlRef.current = sourceUrl;
    }

    if (!isPlaying) {
      audio.pause();
      setTransitionPhase("idle");
      return;
    }

    if (!shouldStartPlayback({ isPlaying, sourceChanged, audioPaused: audio.paused })) {
      setTransitionPhase("idle");
      return;
    }

    const token = transitionTokenRef.current;
    const run = async () => {
      if (!isCurrentSession()) return;
      setTransitionPhase("fadingIn");
      audio.volume = 0;
      audio.muted = false;
      await audio.play();
      if (!isCurrentSession()) {
        audio.pause();
        return;
      }
      await fadeInAudio(token);
      if (!isCurrentSession()) return;
      if (token === transitionTokenRef.current) {
        setTransitionPhase("idle");
      }
    };

    void run().catch(() => {
      if (!isCurrentSession()) return;
      setErrorText("浏览器阻止了自动播放，请手动点击播放");
      setTransitionPhase("idle");
    });
  }, [source, source?.url, source?.trackId, isPlaying, currentTrackId, fadeInAudio, setCurrentTimeMs]);

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
    const canRecoverTargetTrack = (trackId: string | null) => {
      if (!trackId) return false;
      if (transitionPhaseRef.current !== "idle") return false;
      if (appliedTrackIdRef.current !== trackId) return false;
      if (currentSourceRef.current?.trackId && currentSourceRef.current.trackId !== trackId) return false;
      return true;
    };
    const isCurrentMediaSession = () => {
      const currentTrackId = currentTrackIdRef.current;
      if (!currentTrackId) return false;
      return canRecoverTargetTrack(currentTrackId);
    };
    const resetRecoveryWindow = () => {
      recoveryRef.current = {
        attempts: 0,
        windowStartedAt: Date.now(),
        lastRecoverAt: recoveryRef.current.lastRecoverAt
      };
    };

    const recoverPlayback = async (reason: "waiting" | "stalled" | "suspend" | "error") => {
      const trackId = currentTrackIdRef.current;
      if (!trackId) return;
      if (!canRecoverTargetTrack(trackId)) return;
      const currentAudio = audioRef.current;
      if (!currentAudio) return;

      const now = Date.now();
      const snapshot = recoveryRef.current;
      if (
        !canStartRecovery({
          inFlight: recoveryInFlightRef.current,
          now,
          lastRecoverAt: snapshot.lastRecoverAt,
          cooldownMs: RECOVERY_COOLDOWN_MS
        })
      ) {
        return;
      }
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
      if (!canRecoverTargetTrack(trackId)) return;

      const sessionSnapshot = {
        sessionId: playbackSessionRef.current,
        trackId,
        token: transitionTokenRef.current
      };
      const isCurrentSession = () =>
        isSessionValid(
          sessionSnapshot,
          playbackSessionRef.current,
          currentTrackIdRef.current,
          transitionTokenRef.current
        );
      const resumeMs = Math.floor(currentAudio.currentTime * 1000);
      recoveryInFlightRef.current = true;
      try {
        const cachedAudio = fullAudioCacheRef.current.get(trackId);
        if (cachedAudio && currentAudio.src !== cachedAudio.blobUrl) {
          if (!isCurrentSession() || !canRecoverTargetTrack(trackId)) return;
          resumeAfterSourceSwitchRef.current = resumeMs;
          setSource({
            trackId,
            url: cachedAudio.blobUrl,
            bitrate: currentSourceRef.current?.bitrate
          });
          setErrorText("网络波动，已切换缓存继续播放");
          return;
        }

        const renewed = await getTrackPlaySource(trackId);
        if (!isCurrentSession() || !canRecoverTargetTrack(trackId) || renewed.trackId !== trackId) return;
        prefetchedSourceRef.current.set(trackId, { source: renewed, cachedAt: Date.now() });
        resumeAfterSourceSwitchRef.current = resumeMs;
        setSource(renewed);
        void cacheTrackAudioBlob(trackId, renewed.url);
        setErrorText(reason === "error" ? "播放链路已刷新" : "网络波动，已刷新播放链路");
      } catch (error) {
        if (!isCurrentSession() || !canRecoverTargetTrack(trackId)) return;
        const message = (error as Error).message || "音频播放失败";
        try {
          const insight = await getTrackInsight(trackId);
          if (!isCurrentSession() || !canRecoverTargetTrack(trackId)) return;
          const fallbackTrack = insight.alternatives.find((item) => item.id && item.id !== trackId);
          if (fallbackTrack) {
            setErrorText(`当前歌曲受限，已切换到可播放版本：${fallbackTrack.name}`);
            playTrackNow(fallbackTrack);
            return;
          }
        } catch {
          // 忽略替代推荐失败。
        }
        setErrorText(message);
      } finally {
        recoveryInFlightRef.current = false;
      }
    };

    const onTimeUpdate = () => {
      setCurrentTimeMs(Math.floor(audio.currentTime * 1000));
    };
    const onLoadedMetadata = () => {
      setDurationMs(Math.floor(audio.duration * 1000) || 0);
    };
    const onEnded = () => {
      if (!isCurrentMediaSession()) return;
      if (transitionPhaseRef.current !== "idle") return;
      const now = Date.now();
      if (now - lastEndedAtRef.current < 240) return;
      lastEndedAtRef.current = now;
      resetRecoveryWindow();
      nextTrack();
    };
    const onError = () => {
      if (!isCurrentMediaSession()) return;
      void recoverPlayback("error");
    };
    const onPlaying = () => {
      resetRecoveryWindow();
    };
    const onWaiting = () => {
      if (!isCurrentMediaSession()) return;
      if (!isPlayingRef.current || audio.paused || audio.ended) return;
      void recoverPlayback("waiting");
    };
    const onStalled = () => {
      if (!isCurrentMediaSession()) return;
      if (!isPlayingRef.current || audio.paused || audio.ended) return;
      void recoverPlayback("stalled");
    };
    const onSuspend = () => {
      if (!isCurrentMediaSession()) return;
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
  }, [cacheTrackAudioBlob, currentTrackId, nextTrack, playTrackNow, setCurrentTimeMs, setDurationMs]);

  useEffect(() => {
    if (renewTimerRef.current) {
      window.clearTimeout(renewTimerRef.current);
      renewTimerRef.current = null;
    }
    const sourceTrackId = source?.trackId;
    const sourceUrl = source?.url;
    const sourceTtlSeconds = source?.ttlSeconds;
    if (!sourceTrackId || !sourceUrl || !currentTrackId) return;
    if (sourceTrackId !== currentTrackId) return;
    const trackId = sourceTrackId;
    const sessionSnapshot = {
      sessionId: playbackSessionRef.current,
      trackId,
      token: transitionTokenRef.current
    };

    const ttlMs = sourceTtlSeconds ? sourceTtlSeconds * 1000 : 0;
    if (ttlMs <= 0) return;

    const renewAt = Math.max(1000, ttlMs - 5000);
    renewTimerRef.current = window.setTimeout(async () => {
      try {
        const renewed = await getTrackPlaySource(trackId);
        if (
          !isSessionValid(
            sessionSnapshot,
            playbackSessionRef.current,
            currentTrackIdRef.current,
            transitionTokenRef.current
          )
        ) {
          return;
        }
        prefetchedSourceRef.current.set(trackId, { source: renewed, cachedAt: Date.now() });
        if (sourceTrackId === trackId && sourceUrl === renewed.url) {
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
  }, [source?.trackId, source?.url, source?.ttlSeconds, currentTrackId]);

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
