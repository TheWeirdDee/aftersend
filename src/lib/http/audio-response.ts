import "server-only";

/** Serves audio bytes with HTTP Range support (required for seeking, notably in Safari). */
export function audioResponse(bytes: Uint8Array, mime: string, rangeHeader: string | null, cacheControl: string) {
  const size = bytes.byteLength;
  const base: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };
  const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    const chunk = bytes.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(chunk.byteLength) },
    });
  }
  return new Response(bytes.slice(), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}
