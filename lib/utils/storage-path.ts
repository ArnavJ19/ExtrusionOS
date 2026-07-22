export function getStorageObjectPath(bucket: string, pathOrUrl: string) {
  if (!/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl.replace(/^\/+/, "").split("?")[0];

  try {
    const url = new URL(pathOrUrl);
    const marker = "/storage/v1/object/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    let path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    path = path.replace(/^(?:sign|public|authenticated)\//, "");
    if (path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
    return path || null;
  } catch {
    return null;
  }
}
