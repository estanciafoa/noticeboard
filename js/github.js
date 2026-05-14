const repoOwner = "estanciafoa";
const repoName = "noticeboard";

let token = "";

/* GITHUB FETCH */
async function githubFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const baseHeaders = { ...(options.headers || {}) };
  const headersWithAuth = token
    ? { ...baseHeaders, Authorization: `Bearer ${token}` }
    : baseHeaders;

  let res = await fetch(url, {
    ...options,
    headers: headersWithAuth
  });

  // If token is invalid/expired, allow public GET fallback for read-only flows.
  if (res.status === 401 && token && method === "GET") {
    res = await fetch(url, {
      ...options,
      headers: baseHeaders
    });
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const err = await res.json();
      if (err && err.message) msg = err.message;
    } catch (_) {}
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }

  // 204 No Content (e.g. some DELETEs) has no body
  if (res.status === 204) return null;

  return await res.json();
}

/* BASE64 */
function toBase64(f) {
  return new Promise(r => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result.split(",")[1]);
    reader.readAsDataURL(f);
  });
}
