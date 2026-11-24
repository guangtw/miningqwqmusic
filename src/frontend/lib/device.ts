// 设备识别：iPhone（含 iPhone 上的 Chrome / 微信，内核都是 WebKit）走一套更省的渲染路径。
// <html data-device="iphone"> 由 app/layout.tsx 里的内联脚本在首帧前写好，CSS 直接按它分支。

export const isIPhone = () => typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent);

/** iPadOS 默认伪装成 Mac，靠触摸点数认出来 */
export const isIOS = () =>
  isIPhone() || /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 安卓（浏览器和安卓客户端的 WebView 都算）：主内容区左右滑动切换一级页面只在这里开 */
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
