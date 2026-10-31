// Account requests must target server configuration, never the incoming Host.
export function accountServiceUrl(pathSegments: string[]): URL {
  const base = process.env.ACCOUNT_SERVICE_BASE_URL?.trim();
  if (!base) throw new Error("ACCOUNT_SERVICE_NOT_CONFIGURED");
  const target = new URL(base.endsWith("/") ? base : `${base}/`);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
    throw new Error("ACCOUNT_SERVICE_TARGET_INVALID");
  }
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || /[/\\\x00-\x1f]/.test(segment))) {
    throw new Error("ACCOUNT_SERVICE_PATH_INVALID");
  }
  target.pathname = `${target.pathname.replace(/\/$/, "")}/api/account/${pathSegments.map(encodeURIComponent).join("/")}`;
  return target;
}
