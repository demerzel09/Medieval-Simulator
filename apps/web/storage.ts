function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("lords-and-promises", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("saves");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function persist(value: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction("saves", "readwrite");
    t.objectStore("saves").put(value, "latest");
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
export async function restore() {
  const db = await database();
  return new Promise<string | undefined>((resolve, reject) => {
    const r = db.transaction("saves").objectStore("saves").get("latest");
    r.onsuccess = () => {
      db.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
  });
}
