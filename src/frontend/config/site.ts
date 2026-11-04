// 站点配置：文案、导航、首页版式、接口路径都在这里改，组件里不写死。
// 构建时可用 VITE_* 环境变量覆盖其中几项（见 .env.example）。
import { PLAY_QUALITY_LABELS, PLAY_QUALITY_LEVELS } from '@/src/lib/play-quality';
import type { DiscoverItemType, PlayQualityLevel } from '../api/types';

const env = {
  VITE_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
  VITE_BRAND_BIG: process.env.NEXT_PUBLIC_BRAND_BIG,
  VITE_BRAND_SMALL: process.env.NEXT_PUBLIC_BRAND_SMALL,
  VITE_API_BASE: '',
  VITE_DEFAULT_QUALITY: process.env.NEXT_PUBLIC_DEFAULT_QUALITY,
  VITE_REPLACE_TOPLIST_COVERS: process.env.NEXT_PUBLIC_REPLACE_TOPLIST_COVERS,
  VITE_IMAGE_RESIZE: process.env.NEXT_PUBLIC_IMAGE_RESIZE,
};

export type BlockLayout = 'banner' | 'grid' | 'shelf' | 'chart' | 'list';

const brandBig = (env.VITE_BRAND_BIG as string) || 'Mining';
const brandSmall = (env.VITE_BRAND_SMALL as string) || '唱片行';

export const site = {
  /** 完整站名：标签页标题、读屏文字等用它 */
  name: (env.VITE_SITE_NAME as string) || `${brandBig}${brandSmall}`,
  /** 侧栏站标分两行：大字一行、小字一行 */
  brand: { big: brandBig, small: brandSmall },
  footerNote: '数据由站内 BFF 提供',
} as const;

export const api = {
  /** BFF 地址。留空 = 与前端同源（部署在同一域名下，或开发时走 Vite 代理） */
  base: ((env.VITE_API_BASE as string) || '').replace(/\/+$/, ''),
  pageSize: 30,
  /** 播放地址过期前提前多少秒续签 */
  playUrlRenewLeadSeconds: 20,
  /** 已登录时，多久从云端拉一次收藏/最近播放（毫秒） */
  libraryPullIntervalMs: 5 * 60_000,
  /** 密码规则，和账户服务一致（AUTH_PASSWORD_MIN_LENGTH 最低 10） */
  password: { min: 10, max: 128 },
  /** 头像上传上限（账户服务 5MB） */
  avatarMaxBytes: 5 * 1024 * 1024,
  /** 账户服务单个请求最多多少个 JSON 字段（AUTH_JSON_BODY_MAX_FIELDS），自建歌单按它分卷存 */
  cloudFieldLimit: 400,
  /** 本地最多保留多少条最近播放 */
  recentLimit: 100,
  paths: {
    discoverHome: '/api/music/discover/home',
    searchAssist: '/api/music/discover/search-assist',
    searchTracks: '/api/music/search',
    searchArtists: '/api/music/search/artists',
    searchPlaylists: '/api/music/search/playlists',
    track: '/api/music/track/:id',
    playUrl: '/api/music/track/:id/play-url',
    lyric: '/api/music/track/:id/lyric',
    qualityOptions: '/api/music/track/:id/quality-options',
    insight: '/api/music/track/:id/insight',
    downloadUrl: '/api/music/track/:id/download-url',
    comments: '/api/music/track/:id/comments',
    /** Windows / Android 客户端的版本、大小和哈希 */
    clientDownloads: '/api/downloads',
    sceneSati: '/api/music/scene/sati',
    sceneSport: '/api/music/scene/sport',
    playlist: '/api/music/playlist/:id',
    playlistResolve: '/api/music/playlist/resolve',
    toplists: '/api/music/toplist',
    toplist: '/api/music/toplist/:id',
    album: '/api/music/album/:id',
    artist: '/api/music/artist/:id',

    authLogin: '/api/account/auth/login',
    authRegister: '/api/account/auth/register',
    authEmail: '/api/account/auth/email',
    authEmailRequest: '/api/account/auth/email/request',
    authEmailVerify: '/api/account/auth/email/verify',
    membershipEmailRequest: '/api/account/membership/email/request',
    membershipEmailVerify: '/api/account/membership/email/verify',
    membershipApplication: '/api/account/membership/application',
    membershipResend: '/api/account/membership/application/resend',
    adminMembership: '/api/account/admin/membership',
    adminMembershipApps: '/api/account/admin/membership/applications',
    adminMembershipMail: '/api/account/admin/membership/mail',
    adminMembershipAudit: '/api/account/admin/membership/audit',
    authRefresh: '/api/account/auth/refresh',
    authMe: '/api/account/auth/me',
    authLogout: '/api/account/auth/logout',
    authLogoutAll: '/api/account/auth/logout-all',
    authChangePassword: '/api/account/auth/change-password',
    profile: '/api/account/profile',
    profileAvatar: '/api/account/profile/avatar',
    librarySnapshot: '/api/account/library/snapshot',
    libraryFavorites: '/api/account/library/favorites',
    libraryFavorite: '/api/account/library/favorites/:id',
    libraryRecent: '/api/account/library/recent',
    libraryPlaylist: '/api/account/library/imported-playlists/:id',
    libraryPlaylistOrder: '/api/account/library/imported-playlists/:id/order',
    unblockEntitlement: '/api/account/music/unblock/entitlement',
    unblockRedeem: '/api/account/music/unblock/redeem',
    adminAuthUsers: '/api/account/admin/playback-authorizations/users',
    adminAuthGrant: '/api/account/admin/playback-authorizations/grant',
    adminAuthRevoke: '/api/account/admin/playback-authorizations/revoke',
    friends: '/api/account/friends',
    friend: '/api/account/friends/:id',
    friendSearch: '/api/account/friends/search',
    friendRequests: '/api/account/friends/requests',
    friendRequestAction: '/api/account/friends/requests/:id/:action',
    listenRooms: '/api/account/listen/rooms',
    listenJoin: '/api/account/listen/rooms/join',
    listenRoom: '/api/account/listen/rooms/:id',
    listenRoomAction: '/api/account/listen/rooms/:id/:action',
    listenInvites: '/api/account/listen/invites',
    listenInviteAction: '/api/account/listen/invites/:id/:action',
    conversations: '/api/account/messages/conversations',
    conversation: '/api/account/messages/users/:id',
    directMessages: '/api/account/messages/users/:id/messages',
    directRead: '/api/account/messages/users/:id/read',
    message: '/api/account/messages/:id',
    messageResource: '/api/account/messages/:id/resource',
    accountEvents: '/api/account/events',
    accountEventStream: '/api/account/events/stream',
  },
  /**
   * BFF 返回英文错误时给用户看的中文说明（code 见 BFF 的 src/lib/errors.ts）。
   * 没列到的 code：后端给的是中文就原样显示，否则显示 fallback。
   */
  errorText: {
    1000: '出了点意外，稍后再试。',
    2002: '音乐上游限制了请求频率，请稍后重试。',
    2003: '音乐服务有点忙，过一会儿再试。',
    2004: '音乐服务响应太慢了，稍后再试。',
    2005: '连不上音乐服务。',
    2006: '音乐服务返回了看不懂的内容。',
    2007: '音乐服务返回了看不懂的内容。',
    2008: '音乐服务请求较多，稍后再试。',
    2011: '本次音乐请求已达到尝试上限，请重新操作。',
    2010: '当前音乐接口暂时不可用，可以稍后重试或换一首。',
    3001: '找不到这首歌。',
    3002: '这首歌暂时没有可用的音源。',
    3003: '找不到这张歌单。',
    3011: '暂时无法下载这首歌。',
    4001: '缺少搜索关键词。',
    5101: '提交的内容不合规，检查一下再试。',
    5102: '内容太多了，账户服务收不下。',
    5202: '邮箱或密码不对。',
    5205: '操作太频繁了，歇一会儿再试。',
    5301: '头像图片不能用：只支持 PNG、JPG、WebP、GIF，5MB 以内。',
    5401: '账户服务未启用。',
    5501: '邀请码无效、已停用或已过期。',
    5502: '房间码没生成出来，再试一次。',
    5503: '找不到这个房间，房间码可能输错了，或者房间已经散了。',
    5504: '你已经不在这个房间里了。',
    5505: '这个房间已经散了。',
    5506: '房间满了，最多 8 个人一起听。',
    5601: '好友操作没成功，稍后再试。',
    5602: '不能加自己为好友。',
    5603: '找不到这个用户。',
    5604: '你们已经是好友了。',
    5605: '这条好友请求不存在或已经处理过了。',
    5606: '这条好友请求已经处理过了。',
    5607: '你们已经不是好友了。',
    5608: '只能邀请好友一起听。',
    5702: '不能邀请自己。',
    5703: '你不在这个房间里，没法邀请别人。',
    5704: '这个邀请不存在或已经失效了。',
    5705: '这个邀请已经处理过了。',
    5706: '邀请你的人已经离开了房间。',
    5707: '对方已经在房间里了。',
    5801: '不能给自己发私信。',
    5802: '找不到这个用户，对方可能已经注销了。',
    5803: '这条消息和之前的发送记录对不上，重新发一次。',
    5804: '对方回复之前，最多只能发 3 条。',
    5805: '发得太快了，歇一会儿再发。',
    5806: '这条消息找不到了，刷新一下。',
    5808: '这张歌单还没同步到云端，或者已经删了。',
    5809: '这张卡片里的内容已经打不开了。',
    5810: '这个邀请和消息对不上，刷新一下。',
    5811: '这个一起听房间已经不在了。',
    5901: '这张歌单已经不在了。',
    5902: '只有自建歌单可以排序。',
    5903: '歌单内容变了，刷新后再排一次。',
    // 会员申请与验证码（5902 在会员接口里另有含义，见 lib/membership.ts）
    5900: '邮件服务暂时不可用，稍后再试。',
    5904: '会员申请暂时没有开放。',
    5905: '验证码不对，或者已经过期、用过了。重新获取一个再试。',
    5906: '先确认一下账号邮箱。',
    5907: '你已经是会员了，申请码不能叠加时长。',
    5908: '这个账号的申请受到限制，需要管理员处理。',
    5909: '现在没有可以重发的邮件。',
    5910: '操作太频繁了，等一会儿再试。',
    5911: '找不到这条申请。',
    5912: '这条申请已经兑换成会员了，要在会员管理里处理。',
    5913: '这个兑换码绑定的是别的账号。',
    5914: '请求有点多，稍后再试。',
  } as Record<number, string>,
  errorFallback: '请求失败，稍后再试。',
  /** 账户服务返回这些 code 表示服务未启用 / 会话失效 */
  codes: {
    accountDisabled: 5401,
    invalidSession: [5203, 5204],
  },
} as const;

export const nav: { key: string; label: string; to: string }[] = [
  { key: '', label: '本期', to: '#/' },
  { key: 'search', label: '搜索', to: '#/search' },
  { key: 'charts', label: '榜单', to: '#/charts' },
  { key: 'radio', label: '电台', to: '#/radio' },
  { key: 'library', label: '唱片架', to: '#/library' },
  { key: 'settings', label: '设置', to: '#/settings' },
];

/**
 * 首页版式：后端返回的每个推荐区块按这里决定怎么排。
 * 先看区块 id 有没有指定，没有就按区块里大多数条目的类型来定。
 */
export const homeLayout = {
  byBlockId: {
    'discover-banner': 'banner',
    'discover-toplist': 'chart',
  } as Record<string, BlockLayout>,
  byItemType: {
    banner: 'banner',
    playlist: 'grid',
    album: 'shelf',
    artist: 'shelf',
    toplist: 'chart',
    track: 'list',
    scene: 'grid',
  } as Record<DiscoverItemType, BlockLayout>,
  /** 封面故事取哪个区块的第一项；找不到就用第一个 grid 区块 */
  featureBlockId: 'discover-personalized',
  /** 每种版式最多展示几项 */
  limits: { banner: 8, grid: 12, shelf: 12, chart: 8, list: 10 } as Record<BlockLayout, number>,
};

/** 音质分三档：常规（有损码率）、无损、臻品（环绕声 / 母带） */
export type QualityTier = 'standard' | 'lossless' | 'premium';

/**
 * 音质的展示信息。档位、名字、顺序都以后端 src/lib/play-quality.ts 为准，
 * 这里只补前端排版要用的：归哪一档、一行规格说明、标识样式。
 * mark：标识的样式类名，同一类共用一种视觉（sq 金描边、hr 金色实心、spatial 彩虹声场、master 金箔）。
 */
const QUALITY_PRESENTATION: Record<PlayQualityLevel, { tier: QualityTier; spec: string; mark?: { text: string; kind: 'sq' | 'hr' | 'spatial' | 'master' } }> = {
  standard: { tier: 'standard', spec: '128 kbps' },
  higher: { tier: 'standard', spec: '192 kbps' },
  exhigh: { tier: 'standard', spec: '320 kbps' },
  lossless: { tier: 'lossless', spec: 'FLAC · 16 bit', mark: { text: 'SQ', kind: 'sq' } },
  hires: { tier: 'lossless', spec: '24 bit · 最高 192 kHz', mark: { text: 'Hi-Res', kind: 'hr' } },
  jyeffect: { tier: 'premium', spec: '环绕声效', mark: { text: '5.1', kind: 'spatial' } },
  sky: { tier: 'premium', spec: '空间音频', mark: { text: '360°', kind: 'spatial' } },
  dolby: { tier: 'premium', spec: 'Dolby Atmos', mark: { text: '3D', kind: 'spatial' } },
  jymaster: { tier: 'premium', spec: '母带级 · 24 bit', mark: { text: 'MASTER', kind: 'master' } },
};

export const qualities = PLAY_QUALITY_LEVELS.map((key) => ({ key, label: PLAY_QUALITY_LABELS[key], ...QUALITY_PRESENTATION[key] }));
export type QualityOption = (typeof qualities)[number];

export const qualityTiers: { key: QualityTier; label: string; note: string }[] = [
  { key: 'standard', label: '常规', note: '省流量' },
  { key: 'lossless', label: '无损', note: '原汁原味' },
  { key: 'premium', label: '臻品', note: '环绕与母带' },
];

export const defaultQuality: PlayQualityLevel = ((env.VITE_DEFAULT_QUALITY as PlayQualityLevel) || 'exhigh');

export const searchTabs = [
  { key: 'all', label: '综合' },
  { key: 'track', label: '单曲' },
  { key: 'artist', label: '艺人' },
  { key: 'playlist', label: '歌单' },
] as const;

/**
 * 榜单封面替换：上游的榜单封面是统一模板图，这里换成唱片行风格的生成封面。
 * palette 是 [底色, 强调色]，按榜单 id 固定选一组。
 */
/**
 * 首页刊头的「今日卷首语」：每天从封面故事歌单里挑一首歌，摘一句歌词放在刊头。
 * 同一天内固定（缓存在本机），第二天自动换。
 */
export const epigraph = {
  label: '今日卷首语',
  /** 当天没摘到句子（后端没推荐歌单、全是纯音乐……）时刊头显示这句 */
  fallback: '今天，放一张唱片吧。',
  /** 摘句长度（按字符数），太短没味道，太长排不下 */
  minChars: 5,
  maxChars: 22,
  /** 最多试几首歌（纯音乐、没歌词的会跳过） */
  maxTracks: 5,
  /** 「从这句开始听」时提前多少毫秒起播，让这句完整落进耳朵 */
  playLeadMs: 800,
  /** 署名行（作词、作曲……）不选 */
  skip: /作词|作曲|编曲|制作|混音|母带|监制|和声|吉他|贝斯|鼓|录音|出品|发行|统筹|策划|OP|SP|produc|lyrics|compos|arrang|[:：]/i,
};

export const covers = {
  replaceToplist: (env.VITE_REPLACE_TOPLIST_COVERS as string) !== 'off',
  palette: [
    ['#E8432E', '#FFD25A'],
    ['#1F5FD6', '#9BE3FF'],
    ['#0E8F63', '#D4F7A1'],
    ['#6D3FE0', '#F5B3FF'],
    ['#141414', '#FF5A1F'],
    ['#F2A516', '#141414'],
    ['#D0266F', '#FFE08A'],
    ['#0F6B66', '#FFB4A2'],
    ['#2E3A4F', '#FFB86B'],
    ['#E9E4D8', '#E8432E'],
    ['#9B1D20', '#F7C8B8'],
    ['#00A3C4', '#141414'],
  ] as [string, string][],
};

/** 图片缩略：网易云图片支持 ?param=WxH，后端换了图床可关掉 */
export const image = {
  resizeParam: (env.VITE_IMAGE_RESIZE as string) !== 'off',
};
