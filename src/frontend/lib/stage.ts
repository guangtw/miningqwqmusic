// 沉浸舞台：一张 WebGL 画布，一条 rAF。
//
// 画面（从后往前）：
// 1. 背景：封面缩成很小的图，在着色器里按流场扭着采样，像被封面颜色照亮的舞台烟雾；上亮下暗，底下沉进黑里。
//    在 1/4 分辨率的离屏缓冲里画，再放大到屏幕并加一层胶片颗粒（暗部渐变不出色带）。
// 2. 唱片：封面按「方 → 圆」映射铺到一张由几万个光点组成的唱片上，光点沿唱纹一圈圈排列。
//    唱片悬在一块看不见的镜面地板上方，慢慢转（暂停时像唱机一样慢慢停下）；
//    固定方向的一道各向异性高光（黑胶上那两道亮楔），景深（离焦的点变大变淡），底鼓来时中心像喇叭纸盆一样鼓起、
//    沿唱纹推出一圈波；换歌时新封面从中心向外「落针」铺开。
// 3. 倒影：同一批点按地板镜像再画一遍，只画一部分、很淡。
// 4. 浮尘：金色微粒从唱片上慢慢升起，鼓点时亮一下。

export interface StageOptions {
  /** 手机：点数、像素比上限都低一档 */
  phone: boolean;
  /** 减少动态效果：唱片不转、不起伏、镜头不动 */
  still: boolean;
}

const TAU = Math.PI * 2;
const RIPPLES = 4;
/** 唱片悬空高度；地板在 y = 0 */
const LIFT = 0.26;

// ---------------- 着色器 ----------------

const QUAD_VS = `
attribute vec2 a_p;
varying vec2 v_uv;
void main() { v_uv = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }`;

const BG_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_mix;
uniform float u_time;
uniform float u_kick;
uniform float u_aspect;
uniform float u_shift;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_aspect, 1.0);
  float t = u_time;
  // 两层流场扭曲：大尺度慢慢翻涌，小尺度在上面细细地流
  vec2 q = vec2(n(p * 1.4 + vec2(0.0, t * 0.045)), n(p * 1.4 + vec2(5.2, 1.3) - t * 0.04));
  vec2 r = vec2(n(p * 2.6 + q * 2.2 + vec2(1.7, 9.2) + t * 0.03), n(p * 2.6 + q * 2.2 + vec2(8.3, 2.8) - t * 0.035));
  float a = t * 0.018;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 uv = R * (p * 0.55) + (r - 0.5) * 0.7 + 0.5;
  vec3 c = mix(texture2D(u_a, uv).rgb, texture2D(u_b, uv).rgb, u_mix);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.45);
  // 舞台光：顶上亮、往下沉进黑里；唱片那一带留一点被唱片照亮的余光
  float y = v_uv.y + u_shift * 0.25;
  float top = smoothstep(0.05, 1.0, y);
  float spot = exp(-dot(p * vec2(0.9, 1.6), p * vec2(0.9, 1.6)) * 1.2);
  float haze = 0.55 + 0.45 * n(p * 3.0 + q * 3.0 - t * 0.06);
  float k = (0.06 + 0.5 * top * top + 0.12 * spot) * haze;
  k *= 1.0 + u_kick * 0.14;
  gl_FragColor = vec4(c * k, 1.0);
}`;

const POST_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2 u_res;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec2 d = v_uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.9;
  // 胶片颗粒：每帧换种子，±1.5/255，顺手把暗部 8 位色带打散
  float g = h(gl_FragCoord.xy + fract(u_time * 7.0) * 113.0) - 0.5;
  c += g * (3.0 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}`;

const DISC_VS = `
precision highp float;
attribute vec2 a_polar;
attribute vec3 a_seed;
attribute vec3 a_old;
attribute vec3 a_new;
uniform mat4 u_vp;
uniform float u_time;
uniform float u_spin;
uniform float u_kick;
uniform float u_wipe;
uniform float u_assemble;
uniform float u_scale;
uniform float u_size;
uniform float u_focus;
uniform float u_mirror;
uniform float u_light;
uniform float u_density;
uniform vec4 u_rip[${RIPPLES}];
varying vec3 v_col;
varying float v_alpha;
void main() {
  float r = a_polar.x;
  float th = a_polar.y + u_spin;
  // 唱纹上细细的起伏 + 鼓点时纸盆鼓起 + 一圈圈推出去的波
  float hgt = sin(r * 46.0 - u_time * 1.4 + a_seed.x * 2.0) * 0.004;
  hgt += u_kick * 0.15 * pow(1.0 - r, 2.2);
  float glow = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 rp = u_rip[i];
    if (rp.x >= 0.0) {
      float front = rp.x * 0.62;
      float d = r - front;
      float wave = rp.y * exp(-d * d * 140.0) * exp(-rp.x * 1.25) * smoothstep(0.0, 0.08, r);
      hgt += wave * 0.095;
      glow += wave;
    }
  }
  vec3 pos = vec3(cos(th) * r, LIFT + hgt, sin(th) * r);
  // 入场：从四周散开的位置飞回各自的唱纹，中心先到
  float k = clamp(u_assemble * 1.9 - a_seed.z * 0.55 - r * 0.35, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  float sa = a_seed.x * 6.2832;
  float sr = 2.2 + a_seed.y * 2.8;
  vec3 from = vec3(cos(sa) * sr, LIFT + (a_seed.z - 0.3) * 2.4, sin(sa) * sr);
  pos = mix(from, pos, e);
  if (u_mirror > 0.5) pos.y = -pos.y;
  vec4 clip = u_vp * vec4(pos, 1.0);
  gl_Position = clip;

  // 换歌：新封面从中心往外铺开，铺到的那一圈亮一下
  float w = smoothstep(r - 0.05, r + 0.02, u_wipe);
  vec3 col = mix(a_old, a_new, w);
  col += vec3(1.0, 0.92, 0.78) * exp(-(r - u_wipe) * (r - u_wipe) * 500.0) * step(u_wipe, 1.1) * 0.55;
  // 黑胶高光：固定朝向的两道亮楔，唱片转、高光不动
  float phi = atan(pos.z, pos.x);
  float sheen = pow(abs(cos(phi - u_light)), 26.0) * smoothstep(0.34, 0.6, r);
  // 标签外沿一道细黑圈、最外圈一道亮边、中心轴孔
  float groove = 1.0 - 0.7 * smoothstep(0.012, 0.0, abs(r - 0.335));
  float rim = smoothstep(0.975, 0.995, r);
  float hole = smoothstep(0.03, 0.05, r);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(lum), col, 1.3), 0.0);
  col = col * (0.82 + 0.75 * sheen + 0.3 * u_kick + 0.55 * glow) * groove + rim * 0.32 + sheen * 0.07 + glow * 0.08;

  // 景深：离焦平面越远，点越大越淡
  float coc = abs(clip.w - u_focus) * 0.55;
  float size = u_size * u_density * u_scale / clip.w;
  gl_PointSize = min(size * (1.0 + coc * 3.0) + coc * 2.5, 48.0);
  float a = hole * mix(0.0, 1.0, e) / (1.0 + coc * coc * 8.0);
  if (u_mirror > 0.5) a *= 0.16 * smoothstep(1.6, 0.2, length(pos.xz));
  v_col = col;
  v_alpha = a;
}`.replace(/LIFT/g, LIFT.toFixed(3));

const DOT_FS = `
precision mediump float;
varying vec3 v_col;
varying float v_alpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float m = smoothstep(0.5, 0.12, length(d)) * v_alpha;
  if (m < 0.004) discard;
  gl_FragColor = vec4(v_col * m, m * 0.9);
}`;

const DUST_VS = `
precision highp float;
attribute vec4 a_seed;
uniform mat4 u_vp;
uniform float u_time;
uniform float u_kick;
uniform float u_scale;
uniform float u_focus;
uniform vec3 u_accent;
varying vec3 v_col;
varying float v_alpha;
void main() {
  float life = fract(a_seed.z + u_time * (0.008 + a_seed.w * 0.014));
  float ang = a_seed.x * 6.2832 + u_time * 0.03 * (a_seed.y - 0.5);
  float rad = 0.2 + a_seed.y * a_seed.y * 1.75;
  vec3 pos = vec3(cos(ang) * rad, LIFT + life * 2.4 - 0.2, sin(ang) * rad);
  vec4 clip = u_vp * vec4(pos, 1.0);
  gl_Position = clip;
  float coc = abs(clip.w - u_focus) * 0.7;
  gl_PointSize = min((0.011 + a_seed.w * 0.012) * u_scale / clip.w * (1.0 + coc * 3.0), 26.0);
  float tw = 0.55 + 0.45 * sin(u_time * (0.8 + a_seed.w * 2.5) + a_seed.x * 40.0);
  v_alpha = sin(life * 3.1416) * tw * (0.32 + u_kick * 0.7) / (1.0 + coc * coc * 6.0);
  v_col = mix(vec3(1.0, 0.8, 0.5), u_accent, a_seed.w * 0.6);
}`.replace(/LIFT/g, LIFT.toFixed(3));

// ---------------- 小工具 ----------------

type GL = WebGLRenderingContext;

function compile(gl: GL, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog) || 'link');
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(prog, i)!.name.replace(/\[0\]$/, '');
    loc[name] = gl.getUniformLocation(prog, name);
  }
  const attr = (name: string) => gl.getAttribLocation(prog, name);
  return { prog, loc, attr };
}
type Program = ReturnType<typeof compile>;

function perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number, shift: number) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[8] = 0;
  // 镜头平移：整个画面往下挪 shift（NDC），上面给歌词留出位置
  out[9] = shift;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
}

function lookAt(out: Float32Array, e: number[], c: number[]) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l; zy /= l; zz /= l;
  // up = (0,1,0)
  let xx = zz, xy = 0, xz = -zx;
  l = Math.hypot(xx, xz) || 1;
  xx /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
  out[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
  out[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
  out[15] = 1;
}

function multiply(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = s;
    }
}

/** 圆盘上的点 → 方形封面上的点（椭圆网格映射的逆），封面整张铺满唱片，四角往里收 */
function discToSquare(x: number, y: number): [number, number] {
  const x2 = x * x, y2 = y * y, s = 2 * Math.SQRT2;
  const u = 0.5 * Math.sqrt(Math.max(0, 2 + x2 - y2 + s * x)) - 0.5 * Math.sqrt(Math.max(0, 2 + x2 - y2 - s * x));
  const v = 0.5 * Math.sqrt(Math.max(0, 2 - x2 + y2 + s * y)) - 0.5 * Math.sqrt(Math.max(0, 2 - x2 + y2 - s * y));
  return [u, v];
}

const smooth = (from: number, to: number, dt: number, tau: number) => to + (from - to) * Math.exp(-dt / tau);

interface CoverData {
  /** 每个点的颜色 RGB */
  colors: Uint8Array;
  /** 背景用的糊图（64×64） */
  bg: HTMLCanvasElement;
  accent: [number, number, number];
}

// ---------------- 舞台 ----------------

export class RecordStage {
  private gl: GL;
  private bg!: Program;
  private post!: Program;
  private disc!: Program;
  private dust!: Program;
  private quad!: WebGLBuffer;
  private polar!: WebGLBuffer;
  private seeds!: WebGLBuffer;
  private colA!: WebGLBuffer;
  private colB!: WebGLBuffer;
  private dustBuf!: WebGLBuffer;
  private bgTexA!: WebGLTexture;
  private bgTexB!: WebGLTexture;
  private fbo!: WebGLFramebuffer;
  private fboTex!: WebGLTexture;
  private fboSize = [0, 0];

  private count: number;
  private dustCount: number;
  private drawCount: number;
  /** 唱片上每个点的 (r, θ)，算封面颜色时要用 */
  private polarData!: Float32Array;

  private dpr: number;
  private width = 1;
  private height = 1;
  private proj = new Float32Array(16);
  private view = new Float32Array(16);
  private vp = new Float32Array(16);

  private start = performance.now();
  private last = 0;
  private spin = 0;
  private spinV = 0;
  private wipe = 2;
  private bgMix = 1;
  private assemble = 0;
  private kickS = 0;
  private ripples = new Float32Array(RIPPLES * 4);
  private rippleAt: number[] = Array(RIPPLES).fill(-1e9);
  private rippleStrength: number[] = Array(RIPPLES).fill(0);
  private rippleNext = 0;
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  private accent: [number, number, number] = [1, 0.8, 0.55];
  private coverSeq = 0;

  // 自适应画质：前几秒按帧时间降像素比、再降点数，只降不升
  private perf = { frames: 0, sum: 0, level: 0 };

  lost = false;
  /** 调试：单独关掉某一层 */
  debug: { noBg?: boolean; noDisc?: boolean; noDust?: boolean } = {};
  onLost?: () => void;

  static create(canvas: HTMLCanvasElement, opts: StageOptions): RecordStage | null {
    const attrs: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = (canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs)) as GL | null;
    if (!gl) return null;
    try {
      return new RecordStage(canvas, gl, opts);
    } catch (e) {
      console.warn('[stage] init failed', e);
      return null;
    }
  }

  private constructor(private canvas: HTMLCanvasElement, gl: GL, private opts: StageOptions) {
    this.gl = gl;
    this.count = opts.phone ? 14000 : 30000;
    this.dustCount = opts.phone ? 220 : 420;
    this.drawCount = this.count;
    this.dpr = Math.min(window.devicePixelRatio || 1, opts.phone ? 2 : 2);
    if (opts.still) this.assemble = 1;
    this.init();
    canvas.addEventListener('webglcontextlost', this.handleLost);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLost?.();
  };

  private init() {
    const gl = this.gl;
    this.bg = compile(gl, QUAD_VS, BG_FS);
    this.post = compile(gl, QUAD_VS, POST_FS);
    this.disc = compile(gl, DISC_VS, DOT_FS);
    this.dust = compile(gl, DUST_VS, DOT_FS);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // 唱纹：一圈圈的环，每圈点数和周长成正比；随后整体打乱顺序，降点数时只画前一段也均匀
    const rings = this.opts.phone ? 92 : 140;
    const r0 = 0.045;
    let circ = 0;
    for (let i = 0; i < rings; i++) circ += r0 + ((1 - r0) * i) / (rings - 1);
    const density = this.count / circ;
    const polar: number[] = [];
    for (let i = 0; i < rings; i++) {
      const r = r0 + ((1 - r0) * i) / (rings - 1);
      const n = Math.max(6, Math.round(r * density));
      const off = Math.random() * TAU;
      for (let j = 0; j < n; j++) polar.push(r + (Math.random() - 0.5) * 0.002, off + ((j + Math.random() * 0.35) / n) * TAU);
    }
    const total = polar.length / 2;
    const order = Array.from({ length: total }, (_, i) => i);
    for (let i = total - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    const pd = new Float32Array(total * 2);
    const sd = new Float32Array(total * 3);
    order.forEach((o, i) => {
      pd[i * 2] = polar[o * 2];
      pd[i * 2 + 1] = polar[o * 2 + 1];
      sd[i * 3] = Math.random();
      sd[i * 3 + 1] = Math.random();
      sd[i * 3 + 2] = Math.random();
    });
    this.count = this.drawCount = total;
    this.polarData = pd;
    this.polar = this.buffer(pd);
    this.seeds = this.buffer(sd);
    // 封面到之前：一张暗暗的黑胶
    const blank = new Uint8Array(total * 3).fill(46);
    this.colA = this.buffer(blank, gl.DYNAMIC_DRAW);
    this.colB = this.buffer(blank, gl.DYNAMIC_DRAW);

    const ds = new Float32Array(this.dustCount * 4);
    for (let i = 0; i < ds.length; i++) ds[i] = Math.random();
    this.dustBuf = this.buffer(ds);

    const dark = document.createElement('canvas');
    dark.width = dark.height = 4;
    const c = dark.getContext('2d')!;
    c.fillStyle = '#16151a';
    c.fillRect(0, 0, 4, 4);
    this.bgTexA = this.texture(dark);
    this.bgTexB = this.texture(dark);

    this.fbo = gl.createFramebuffer()!;
    this.fboTex = gl.createTexture()!;
    this.resize();
  }

  private buffer(data: ArrayBufferView, usage: number = this.gl.STATIC_DRAW) {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return b;
  }

  private texture(src: TexImageSource, tex = this.gl.createTexture()!) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 64×64 是 2 的幂，WebGL1 也能镜像重复：流场把采样点推到封面外面时不会出硬边
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    return tex;
  }

  resize() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (w === this.width && h === this.height && this.fboSize[0]) return;
    this.width = this.canvas.width = w;
    this.height = this.canvas.height = h;
    const fw = Math.max(32, Math.round(rect.width / 4));
    const fh = Math.max(32, Math.round(rect.height / 4));
    this.fboSize = [fw, fh];
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** 换封面：取色要等图片加载，换的那一下从中心往外铺 */
  setCover(url: string | undefined) {
    const seq = ++this.coverSeq;
    if (!url) return;
    loadCover(url, this.polarData).then((data) => {
      if (!data || seq !== this.coverSeq || this.lost) return;
      const gl = this.gl;
      // 正在铺的那一张直接算铺完
      [this.colA, this.colB] = [this.colB, this.colA];
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colB);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.colors);
      [this.bgTexA, this.bgTexB] = [this.bgTexB, this.bgTexA];
      this.texture(data.bg, this.bgTexB);
      this.accent = data.accent;
      this.wipe = this.opts.still ? 2 : -0.05;
      this.bgMix = this.opts.still ? 1 : 0;
      if (!this.opts.still) this.pulse(0.9);
    });
  }

  /** 每次打开面板重演一遍入场：光点从四周聚成唱片，镜头从高处落下来 */
  intro() {
    if (!this.opts.still) this.assemble = 0;
  }

  /** 从中心推出一圈波 */
  pulse(strength: number) {
    if (this.opts.still) return;
    const i = this.rippleNext++ % RIPPLES;
    this.rippleAt[i] = this.now();
    this.rippleStrength[i] = strength;
  }

  /** 指针位置（-1~1），镜头跟着轻轻偏一点 */
  setPointer(x: number, y: number) {
    this.pointer.tx = x;
    this.pointer.ty = y;
  }

  private now() {
    return (performance.now() - this.start) / 1000;
  }

  /** 画一帧。kick：底鼓包络 0~1；playing：唱片转不转 */
  frame(kick: number, playing: boolean) {
    if (this.lost) return;
    const gl = this.gl;
    const t = this.now();
    const dt = Math.min(0.1, Math.max(0.001, t - (this.last || t - 1 / 60)));
    this.last = t;
    this.adapt(dt);
    const still = this.opts.still;

    // 唱机一样：放歌时慢慢转起来，暂停时慢慢停下
    this.spinV = smooth(this.spinV, playing && !still ? 0.2 : 0, dt, playing ? 0.9 : 1.6);
    this.spin += this.spinV * dt;
    if (this.wipe < 1.3) this.wipe += dt / 1.5;
    if (this.bgMix < 1) this.bgMix = Math.min(1, this.bgMix + dt / 1.8);
    if (this.assemble < 1) this.assemble = Math.min(1, this.assemble + dt / 2.1);
    this.kickS = still ? 0 : kick;
    const p = this.pointer;
    p.x = smooth(p.x, p.tx, dt, 0.6);
    p.y = smooth(p.y, p.ty, dt, 0.6);

    // 镜头：低角度看着悬空的唱片，慢慢左右摆；鼓点时往前推一点
    const aspect = this.width / this.height;
    const portrait = aspect < 0.9;
    const fov = (portrait ? 40 : 30) * (Math.PI / 180);
    const tanH = Math.tan(fov / 2);
    const baseEl = portrait ? 0.72 : 0.6;
    const el = baseEl + (still ? 0 : Math.sin(t * 0.05 + 1) * 0.04 - p.y * 0.06);
    // 按画面比例算机位：唱片宽不超过画面宽的 fw、高不超过画面高的 fh（竖屏左右刚好出血到边）
    const fw = portrait ? 1.04 : aspect > 1.9 ? 0.5 : 0.62;
    const fh = portrait ? 0.3 : 0.4;
    let dist = Math.max(1 / (fw * tanH * aspect), Math.sin(baseEl) / (fh * tanH));
    const intro = 1 - this.assemble;
    dist *= 1 + intro * intro * 0.35 - this.kickS * 0.025;
    const az = still ? 0 : Math.sin(t * 0.07) * 0.22 + p.x * 0.16;
    const elev = el + intro * 0.25;
    const target = [0, LIFT * 0.6, 0];
    const eye = [target[0] + dist * Math.cos(elev) * Math.sin(az), target[1] + dist * Math.sin(elev), target[2] + dist * Math.cos(elev) * Math.cos(az)];
    perspective(this.proj, fov, aspect, 0.05, 60, portrait ? 0.3 : 0.27);
    lookAt(this.view, eye, target);
    multiply(this.vp, this.proj, this.view);
    const scale = (1 / tanH) * (this.height / 2);

    // 1. 背景：画到小缓冲里
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboSize[0], this.fboSize[1]);
    this.useQuad(this.bg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexB);
    const L = this.bg.loc;
    gl.uniform1i(L.u_a, 0);
    gl.uniform1i(L.u_b, 1);
    gl.uniform1f(L.u_mix, this.bgMix * this.bgMix * (3 - 2 * this.bgMix));
    gl.uniform1f(L.u_time, still ? 0 : t);
    gl.uniform1f(L.u_kick, this.kickS);
    gl.uniform1f(L.u_aspect, aspect);
    gl.uniform1f(L.u_shift, portrait ? 0.3 : 0.27);
    if (!this.debug.noBg) gl.drawArrays(gl.TRIANGLES, 0, 3);
    else { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }

    // 2. 放大到屏幕 + 颗粒
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    this.useQuad(this.post);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(this.post.loc.u_tex, 0);
    gl.uniform1f(this.post.loc.u_time, t);
    gl.uniform2f(this.post.loc.u_res, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. 唱片和倒影：预乘 alpha 叠上去
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const D = this.disc;
    gl.useProgram(D.prog);
    this.attrib(D.attr('a_polar'), this.polar, 2, gl.FLOAT, false);
    this.attrib(D.attr('a_seed'), this.seeds, 3, gl.FLOAT, false);
    this.attrib(D.attr('a_old'), this.colA, 3, gl.UNSIGNED_BYTE, true);
    this.attrib(D.attr('a_new'), this.colB, 3, gl.UNSIGNED_BYTE, true);
    gl.uniformMatrix4fv(D.loc.u_vp, false, this.vp);
    gl.uniform1f(D.loc.u_time, still ? 0 : t);
    gl.uniform1f(D.loc.u_spin, this.spin);
    gl.uniform1f(D.loc.u_kick, this.kickS);
    gl.uniform1f(D.loc.u_wipe, this.wipe);
    gl.uniform1f(D.loc.u_assemble, this.assemble);
    gl.uniform1f(D.loc.u_scale, scale);
    gl.uniform1f(D.loc.u_size, this.opts.phone ? 0.0105 : 0.0082);
    gl.uniform1f(D.loc.u_focus, dist);
    gl.uniform1f(D.loc.u_light, 2.25 + az * 0.6);
    // 降了点数就把每个点放大一点，唱片的覆盖面积不变，不会变得稀稀拉拉
    gl.uniform1f(D.loc.u_density, Math.sqrt(this.count / this.drawCount));
    for (let i = 0; i < RIPPLES; i++) {
      const age = t - this.rippleAt[i];
      this.ripples[i * 4] = age < 3 ? age : -1;
      this.ripples[i * 4 + 1] = this.rippleStrength[i];
    }
    gl.uniform4fv(D.loc.u_rip, this.ripples);
    if (!this.debug.noDisc) {
      gl.uniform1f(D.loc.u_mirror, 1);
      gl.drawArrays(gl.POINTS, 0, Math.round(this.drawCount * 0.45));
      gl.uniform1f(D.loc.u_mirror, 0);
      gl.drawArrays(gl.POINTS, 0, this.drawCount);
    }
    gl.disableVertexAttribArray(D.attr('a_old'));
    gl.disableVertexAttribArray(D.attr('a_new'));
    gl.disableVertexAttribArray(D.attr('a_seed'));
    gl.disableVertexAttribArray(D.attr('a_polar'));

    // 4. 浮尘：叠加混合
    gl.blendFunc(gl.ONE, gl.ONE);
    const U = this.dust;
    gl.useProgram(U.prog);
    this.attrib(U.attr('a_seed'), this.dustBuf, 4, gl.FLOAT, false);
    gl.uniformMatrix4fv(U.loc.u_vp, false, this.vp);
    gl.uniform1f(U.loc.u_time, still ? 0 : t);
    gl.uniform1f(U.loc.u_kick, this.kickS);
    gl.uniform1f(U.loc.u_scale, scale);
    gl.uniform1f(U.loc.u_focus, dist);
    gl.uniform3f(U.loc.u_accent, ...this.accent);
    if (!this.debug.noDust) gl.drawArrays(gl.POINTS, 0, this.dustCount);
    gl.disableVertexAttribArray(U.attr('a_seed'));
  }

  private useQuad(p: Program) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    this.attrib(p.attr('a_p'), this.quad, 2, gl.FLOAT, false);
  }

  private attrib(loc: number, buf: WebGLBuffer, size: number, type: number, norm: boolean) {
    if (loc < 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
  }

  /** 前 3 秒里每 45 帧看一次平均帧时间，超过 22ms 就降一档：像素比 → 点数 */
  private adapt(dt: number) {
    const p = this.perf;
    if (p.level >= 5 || document.hidden) return;
    p.frames++;
    if (p.frames < 20) return; // 头几帧有编译、上传，不算
    p.sum += dt;
    if (p.frames < 65) return;
    const avg = p.sum / 45;
    p.frames = 20;
    p.sum = 0;
    if (avg < 0.022) {
      p.level = 5; // 够流畅，不再看了
      return;
    }
    p.level++;
    if (this.dpr > 1.25) {
      this.dpr = Math.max(1, this.dpr - 0.5);
      this.resize();
    } else if (this.drawCount > this.count * 0.5) this.drawCount = Math.round(this.drawCount * 0.75);
    else p.level = 5;
  }

  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.coverSeq++;
    // 不 loseContext：同一张画布再建舞台时（StrictMode 的二次挂载、换窄屏）拿到的还是这个上下文，丢了就再也画不出来
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const p of [this.bg, this.post, this.disc, this.dust]) gl.deleteProgram(p.prog);
    for (const b of [this.quad, this.polar, this.seeds, this.colA, this.colB, this.dustBuf]) gl.deleteBuffer(b);
    for (const t of [this.bgTexA, this.bgTexB, this.fboTex]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbo);
    // 真卸载（画布已经离开页面）时把上下文还给浏览器，来回切普通页 / 沉浸页不会攒下一堆上下文
    const canvas = this.canvas;
    setTimeout(() => {
      if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
    }, 0);
  }
}

/** 取封面：每个唱片点的颜色 + 背景糊图 + 一个主色 */
function loadCover(url: string, polar: Float32Array): Promise<CoverData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const S = 160;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, S, S);
        const px = ctx.getImageData(0, 0, S, S).data;
        const n = polar.length / 2;
        const colors = new Uint8Array(n * 3);
        let ar = 0, ag = 0, ab = 0, aw = 0;
        for (let i = 0; i < n; i++) {
          const r = polar[i * 2];
          const th = polar[i * 2 + 1];
          const [u, v] = discToSquare(Math.cos(th) * r, Math.sin(th) * r);
          const x = Math.min(S - 1, Math.max(0, Math.round(((u + 1) / 2) * (S - 1))));
          const y = Math.min(S - 1, Math.max(0, Math.round(((v + 1) / 2) * (S - 1))));
          const o = (y * S + x) * 4;
          // 太暗的封面在黑底上会整张看不见：抬一点底，保住唱片的形
          colors[i * 3] = 18 + px[o] * 0.93;
          colors[i * 3 + 1] = 18 + px[o + 1] * 0.93;
          colors[i * 3 + 2] = 20 + px[o + 2] * 0.93;
          const mx = Math.max(px[o], px[o + 1], px[o + 2]);
          const mn = Math.min(px[o], px[o + 1], px[o + 2]);
          const w = (mx - mn) / 255 + 0.02;
          ar += px[o] * w; ag += px[o + 1] * w; ab += px[o + 2] * w; aw += w;
        }
        // 背景：先缩到 6×6 再放大到 64×64，放大时的插值就是一次很便宜的大半径模糊
        const tiny = document.createElement('canvas');
        tiny.width = tiny.height = 6;
        tiny.getContext('2d')!.drawImage(img, 0, 0, 6, 6);
        const bg = document.createElement('canvas');
        bg.width = bg.height = 64;
        const bctx = bg.getContext('2d')!;
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(tiny, 0, 0, 64, 64);
        const m = Math.max(ar, ag, ab) / aw || 1;
        const accent: [number, number, number] = [ar / aw / m, ag / aw / m, ab / aw / m];
        resolve({ colors, bg, accent });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
