const CACHE_NAME = "reelmeal-v2";
const SHARE_DB = "reelmeal-share-inbox";
const SHARE_STORE = "shares";

self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["/"]))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });

function openShareDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function storeShare(request) {
  const form = await request.formData(); const id = crypto.randomUUID();
  const files = form.getAll("share-images").filter((value) => value instanceof File);
  const entry = { id, createdAt: Date.now(), title: String(form.get("share-title") || ""), text: String(form.get("share-text") || ""), url: String(form.get("share-url") || ""), files };
  const db = await openShareDatabase(); const tx = db.transaction(SHARE_STORE, "readwrite"); tx.objectStore(SHARE_STORE).put(entry);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); return id;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(storeShare(event.request).then((id) => Response.redirect(`/?share=${encodeURIComponent(id)}`, 303)).catch(() => Response.redirect("/?shareError=1", 303))); return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/share-target" || event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); return response; })));
});
