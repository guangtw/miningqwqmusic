"use client";

export type CloudPullMode = "visible" | "silent";

export type CloudPullOptions = {
  force?: boolean;
  mode?: CloudPullMode;
};

export function resolveCloudPullMode(options?: CloudPullOptions): CloudPullMode {
  return options?.mode ?? "silent";
}

export function shouldShowCloudSyncing(options?: CloudPullOptions): boolean {
  return resolveCloudPullMode(options) === "visible";
}

export function shouldSkipRecentCloudPull(
  lastSuccessfulSyncAt: number,
  now: number,
  graceWindowMs: number
): boolean {
  if (lastSuccessfulSyncAt <= 0) return false;
  return now - lastSuccessfulSyncAt < graceWindowMs;
}
