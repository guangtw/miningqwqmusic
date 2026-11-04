import catalog from './catalog.json';

export function getClientDownloads() {
  return {
    schemaVersion: catalog.schemaVersion,
    platforms: catalog.platforms.map((platform) => ({
      ...platform,
      downloadUrl: `/api/downloads/${platform.platform}`,
      artifacts: platform.artifacts.map((artifact) => ({
        ...artifact,
        url: `/downloads/clients/${artifact.fileName}`,
        downloadUrl: `/api/downloads/${platform.platform}?variant=${artifact.variant}`,
      })),
    })),
  };
}

export function findClientDownload(platform: string, variant?: string | null) {
  const entry = getClientDownloads().platforms.find((item) => item.platform === platform);
  return variant == null ? entry?.artifacts[0] : entry?.artifacts.find((item) => item.variant === variant);
}
