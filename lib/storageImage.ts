// Sprint 27 — Supabase Storage image-transform helper.
//
// Converts a public object URL into a resized "render" URL (?width=N) so
// galleries load small thumbnails instead of full-resolution iPhone photos.
// If image transforms are not enabled on the project, callers should pair this
// with an <img onError> fallback that swaps back to the original URL.

export function thumbUrl(publicUrl: string | undefined | null, width = 400): string {
  if (!publicUrl) return "";
  // Only object public URLs can be transformed; pass anything else through.
  if (!publicUrl.includes("/storage/v1/object/public/")) return publicUrl;
  const rendered = publicUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/",
  );
  const sep = rendered.includes("?") ? "&" : "?";
  return `${rendered}${sep}width=${width}&quality=70&resize=contain`;
}
