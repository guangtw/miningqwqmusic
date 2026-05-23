"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getTrackDetail, getTrackLyric, getTrackPlaySource } from "@/src/lib/client-api";
import { locateCurrentLyricIndex } from "@/src/lib/lyrics";
import { pickCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import type { LyricLine, PlaySource, PlaybackMode, Track } from "@/src/types/music";

type TransitionPhase = "idle" | "fadingOut" | "switching" | "fadingIn";

type CachedPlaySource = {
  source: PlaySource;
  cachedAt: number;
};

type ControllerState = {
  currentTrack: Track | null;
  currentSource: PlaySource | null;
  lyricLines: LyricLine[];
  lyricIndex: number;
  errorText: string | null;
  loadingSource: boolean;
  transitionPhase: TransitionPhase;
  audioRef: { current: HTMLAudioElement | null };
  seekTo: (ms: number) => void;
};

const CROSSFADE_MS = 350;
const BASE_GAIN_BOOST = 1.2;
const MAX_GAIN = 1.8;
const PREFETCH_EXPIRE_BUFFER_MS = 8000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolveBoostedGain(volume: number): number {
  if (volume <= 0) return 0;
  if (volume <= 0.8) {
    return Math.min(MAX_GAIN, volume * BASE_GAIN_BOOST);
  }
  const lowPoint = 0.8 * BASE_GAIN_BOOST;
  const ratio = (volume - 0.8) / 0.2;
  return Math.min(MAX_GAIN, lowPoint + ratio * (MAX_GAIN - lowPoint));
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

  const queueTrack = useMemo(() => pickCurrentTrack(queue, currentIndex), [queue, currentIndex]);
  const currentTrackId = queueTrack?.id ?? null;
  const [source, setSource] = useState<PlaySource | null>(null);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [resolvedTrack, setResolvedTrack] = useState<Track | null>(queueTrack);
  const [loadingSource, setLoadingSource] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");

  const renewTimerRef = useRef<number | null>(null);
  const transitionTokenRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const prefetchedSourceRef = useRef<Map<string, CachedPlaySource>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());
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

  const ensureAudioGraph = (): boolean => {
    const audio = audioRef.current;
    if (!audio || typeof window === "undefined") return false;
    const ContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ContextCtor) return false;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new ContextCtor();
      }
      if (!mediaSourceRef.current) {
        mediaSourceRef.current = audioContextRef.current.createMediaElementSource(audio);
      }
      if (!gainNodeRef.current) {
        gainNodeRef.current = audioContextRef.current.createGain();
        mediaSourceRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioContextRef.current.destination);
      }
      audio.volume = 1;
      return true;
    } catch {
      return false;
    }
  };

  const applyGain = (nextVolume: number, smoothMs = 80) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!ensureAudioGraph() || !gainNodeRef.current || !audioContextRef.current) {
      audio.volume = Math.min(1, Math.max(0, nextVolume));
      return;
    }

    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume().catch(() => undefined);
    }

    const now = audioContextRef.current.currentTime;
    const target = resolveBoostedGain(nextVolume);
    gainNodeRef.current.gain.cancelScheduledValues(now);
    gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, now);
    gainNodeRef.current.gain.linearRampToValueAtTime(target, now + smoothMs / 1000);
  };

  const fadeOutAudio = async (token: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const hasCurrentSource = Boolean(currentSourceRef.current?.url || audio.currentSrc || audio.src);
    const shouldFade = isPlayingRef.current && !audio.paused && hasCurrentSource;
    if (!shouldFade) {
      audio.pause();
      return;
    }

    if (ensureAudioGraph() && gainNodeRef.current && audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      const now = audioContextRef.current.currentTime;
      gainNodeRef.current.gain.cancelScheduledValues(now);
      gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, now);
      gainNodeRef.current.gain.linearRampToValueAtTime(0, now + CROSSFADE_MS / 1000);
      await wait(CROSSFADE_MS);
    } else {
      audio.volume = 0;
      await wait(CROSSFADE_MS);
    }

    if (token !== transitionTokenRef.current) return;
    audio.pause();
  };

  const fadeInAudio = async (token: number) => {
    const audio = audioRef.current;
    if (!audio || token !== transitionTokenRef.current) return;
    const targetVolume = volumeRef.current;

    if (ensureAudioGraph() && gainNodeRef.current && audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      const now = audioContextRef.current.currentTime;
      const target = resolveBoostedGain(targetVolume);
      gainNodeRef.current.gain.cancelScheduledValues(now);
      gainNodeRef.current.gain.setValueAtTime(0, now);
      gainNodeRef.current.gain.linearRampToValueAtTime(target, now + CROSSFADE_MS / 1000);
      await wait(CROSSFADE_MS);
    } else {
      audio.volume = 0;
      const steps = 8;
      for (let index = 1; index <= steps; index += 1) {
        if (token !== transitionTokenRef.current) return;
        audio.volume = Math.min(1, (targetVolume * index) / steps);
        await wait(Math.round(CROSSFADE_MS / steps));
      }
    }
  };

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

      const cached = prefetchedSourceRef.current.get(queueTrack.id);
      const validCached = isCachedSourceUsable(cached);
      const playSourcePromise = validCached && cached ? Promise.resolve(cached.source) : getTrackPlaySource(queueTrack.id);

      setTransitionPhase("fadingOut");
      await fadeOutAudio(token);
      if (!active || token !== transitionTokenRef.current) return;

      setTransitionPhase("switching");
      setSource(null);
      setLyricLines([]);
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
        prefetchedSourceRef.current.set(queueTrack.id, { source: playSource, cachedAt: Date.now() });
      } catch (error) {
        if (!active || token !== transitionTokenRef.current) return;
        setErrorText((error as Error).message || "播放地址获取失败");
      } finally {
        if (active && token === transitionTokenRef.current) {
          setLoadingSource(false);
        }
      }

      getTrackLyric(queueTrack.id)
        .then((lyric) => {
          if (!active || token !== transitionTokenRef.current) return;
          setLyricLines(lyric.lines);
        })
        .catch(() => {
          if (!active || token !== transitionTokenRef.current) return;
          setLyricLines([]);
        });
    };

    void run();
    return () => {
      active = false;
    };
  }, [queueTrack, currentTrackId, rememberTrack, setCurrentTimeMs, setDurationMs]);

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
      if (ensureAudioGraph() && gainNodeRef.current && audioContextRef.current) {
        if (audioContextRef.current.state === "suspended") {
          await audioContextRef.current.resume().catch(() => undefined);
        }
        gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
        gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      } else {
        audio.volume = 0;
      }

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
  }, [source, source?.url, source?.trackId, isPlaying, currentTrackId, volume]);

  useEffect(() => {
    if (transitionPhase === "fadingIn" || transitionPhase === "fadingOut") return;
    applyGain(volume, 70);
  }, [volume, transitionPhase]);

  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    const onTimeUpdate = () => {
      setCurrentTimeMs(Math.floor(audio.currentTime * 1000));
    };
    const onLoadedMetadata = () => {
      setDurationMs(Math.floor(audio.duration * 1000) || 0);
    };
    const onEnded = () => {
      nextTrack();
    };
    const onError = async () => {
      if (!queueTrack) return;
      try {
        const renewed = await getTrackPlaySource(queueTrack.id);
        setSource(renewed);
        prefetchedSourceRef.current.set(queueTrack.id, { source: renewed, cachedAt: Date.now() });
        setErrorText("播放地址已刷新");
      } catch (error) {
        setErrorText((error as Error).message || "音频播放失败");
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [queueTrack, currentTrackId, nextTrack, setCurrentTimeMs, setDurationMs]);

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
        setSource(renewed);
        prefetchedSourceRef.current.set(queueTrack.id, { source: renewed, cachedAt: Date.now() });
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

  const lyricIndex = useMemo(() => locateCurrentLyricIndex(lyricLines, currentTimeMs), [lyricLines, currentTimeMs]);

  return {
    currentTrack: resolvedTrack,
    currentSource: source,
    lyricLines,
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
