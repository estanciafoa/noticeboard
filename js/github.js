const repoOwner = "saravanansengamalan";
const repoName = "estancianoticeboard";

let token = "";

/* GITHUB FETCH */
async function githubFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

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
