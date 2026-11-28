// 沉浸模式的节拍表：低频（底鼓）起音的时间点和力度。
//
// 播放用的 <audio> 地址在第三方 CDN 上、不保证带 CORS，接 AnalyserNode 会被浏览器静音（见 player.ts 淡入淡出那段），
// 所以这里不碰正在放的那一份：沉浸模式打开时另外按 CORS 取一份整曲，离线解码 → 150Hz 低通 → 能量包络 → 找起音峰。
// 取不到（CDN 不给跨域、文件太大、浏览器不支持）就返回 null，舞台退回到「歌词换行时推一下」的律动。

export interface BeatMap {
  /** 起音时间，毫秒，升序 */
  times: Float32Array;
  /** 对应力度 0~1（相对整首最强的那几下） */
  strength: Float32Array;
}

/** 整曲超过这个大小就不取了：手机流量和解码内存都划不来（无损 4 分钟约 30MB） */
const MAX_BYTES = 24 * 1024 * 1024;
/** 只看低频，采样率压到 4kHz 足够，解码和渲染都省 */
const RATE = 4000;
const HOP = 40; // 10ms 一帧
const MAX_CACHE = 24;

const cache = new Map<string, Promise<BeatMap | null>>();

export function beatMapOf(trackId: string, url: string | null, signal?: AbortSignal): Promise<BeatMap | null> {
  const hit = cache.get(trackId);
  if (hit) return hit;
  if (!url || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const job = analyse(url, signal).catch(() => null);
  cache.set(trackId, job);
  // 被取消的不留在缓存里，下次进沉浸模式重新取
  job.then((m) => {
    if (!m && signal?.aborted) cache.delete(trackId);
  });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return job;
}

async function analyse(url: string, signal?: AbortSignal): Promise<BeatMap | null> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) return null;
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_BYTES) {
    void res.body?.cancel();
    return null;
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return null;
  signal?.throwIfAborted();

  // 先按 4kHz 解码（decodeAudioData 会重采样到上下文的采样率），再过一遍低通渲染出来
  const probe = new OfflineAudioContext(1, 1, RATE);
  const decoded = await probe.decodeAudioData(bytes);
  signal?.throwIfAborted();
  const ctx = new OfflineAudioContext(1, decoded.length, RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  lp.Q.value = 0.8;
  src.connect(lp).connect(ctx.destination);
  src.start();
  const low = (await ctx.startRendering()).getChannelData(0);
  signal?.throwIfAborted();
  return detect(low, RATE, HOP);
}

/**
 * 起音检测（导出给单测用）：
 * 整流后过一个「快起慢落」的包络跟随器（起 4ms、落 70ms），低频正弦在短窗里按相位忽大忽小的抖动就没了；
 * 再取 20ms 跨度的上升量，在 ±60ms 内是局部最大、且高过前后 400ms 均值的 1.5 倍、并且不小于整首最大上升量的 8% 才算一下
 */
export function detect(samples: Float32Array, rate: number, hop: number): BeatMap | null {
  const frames = Math.floor(samples.length / hop);
  if (frames < 200) return null;
  const up = 1 - Math.exp(-1 / (0.004 * rate));
  const down = 1 - Math.exp(-1 / (0.07 * rate));
  const env = new Float32Array(frames);
  let e = 0;
  for (let i = 0, f = 0; f < frames; f++) {
    for (const end = (f + 1) * hop; i < end; i++) {
      const x = Math.abs(samples[i]);
      e += (x - e) * (x > e ? up : down);
    }
    env[f] = e;
  }
  const frameMs = (hop / rate) * 1000;
  const span = Math.max(1, Math.round(20 / frameMs));
  const flux = new Float32Array(frames);
  let top = 0;
  for (let f = span; f < frames; f++) {
    flux[f] = Math.max(0, env[f] - env[f - span]);
    if (flux[f] > top) top = flux[f];
  }
  if (top < 1e-3) return null;

  const win = Math.round(400 / frameMs);
  const local = Math.round(60 / frameMs);
  const minGap = Math.round(180 / frameMs);
  // 前缀和求滑动均值
  const sum = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) sum[f + 1] = sum[f] + flux[f];
  const times: number[] = [];
  const raw: number[] = [];
  let last = -minGap;
  for (let f = 1; f < frames - 1; f++) {
    const v = flux[f];
    if (v < top * 0.08 || f - last < minGap) continue;
    const lo = Math.max(0, f - win);
    const hi = Math.min(frames, f + win + 1);
    if (v <= ((sum[hi] - sum[lo]) / (hi - lo)) * 1.5) continue;
    let peak = true;
    for (let k = Math.max(0, f - local); k <= Math.min(frames - 1, f + local); k++)
      if (flux[k] > v || (flux[k] === v && k < f)) {
        peak = false;
        break;
      }
    if (!peak) continue;
    last = f;
    // 上升段的中点更接近听到的那一下
    times.push((f - span / 2) * frameMs);
    raw.push(v);
  }
  if (times.length < 8) return null;
  // 力度按整首 90 分位归一，个别爆点不至于把其余的都压成很小
  const sorted = [...raw].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.9)] || sorted[sorted.length - 1];
  const strength = new Float32Array(raw.map((v) => Math.min(1, v / ref)));
  return { times: new Float32Array(times), strength };
}

/** 第一个时间 >= t 的下标 */
export function beatIndexAt(map: BeatMap, t: number): number {
  let lo = 0;
  let hi = map.times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map.times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
