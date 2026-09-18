interface StoredShare { id: string; createdAt: number; title: string; text: string; url: string; files: File[] }
const DB_NAME = "reelmeal-share-inbox";
const STORE = "shares";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

export async function consumeSharedPayload(): Promise<{ title: string; text: string; url: string; files: File[] } | null> {
  if (typeof indexedDB === "undefined") return null;
  const params = new URLSearchParams(location.search); const id = params.get("share"); const db = await openDatabase();
  const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE);
  const all = await new Promise<StoredShare[]>((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const now = Date.now(); for (const entry of all) if (now - entry.createdAt > 24 * 60 * 60 * 1000 || entry.id === id) store.delete(entry.id);
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); }); db.close();
  if (!id) return null; const entry = all.find((item) => item.id === id); if (!entry) return null;
  params.delete("share"); history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  return { title: entry.title, text: entry.text, url: entry.url, files: entry.files };
}
