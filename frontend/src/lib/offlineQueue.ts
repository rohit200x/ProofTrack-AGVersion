import { api, ApiError } from "../api/client";
import type { FailureReason } from "../types";

export interface StoredFileBlob {
  name: string;
  type: string;
  blob: Blob;
}

export interface PendingSubmission {
  idempotencyKey: string;
  deliveryId: string;
  deliveryReference: string;
  recipientDisplay: string;
  action: "COMPLETE" | "FAIL";
  images: StoredFileBlob[];
  recipientName?: string;
  driverNotes?: string;
  failureReason?: FailureReason;
  failureNotes?: string;
  latitude?: string;
  longitude?: string;
  locationAccuracyM?: string;
  locationConsent?: boolean;
  status: "QUEUED" | "SYNCING" | "ERROR";
  errorMessage?: string;
  createdAt: string;
}

const DB_NAME = "prooftrack_offline_db";
const DB_VERSION = 1;
const STORE_QUEUE = "pending_submissions";

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export function subscribeOfflineQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "idempotencyKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listPendingSubmissions(): Promise<PendingSubmission[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readonly");
      const store = tx.objectStore(STORE_QUEUE);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as PendingSubmission[]) || [];
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function enqueuePendingSubmission(
  submission: PendingSubmission
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).put(submission);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyListeners();
}

export async function removePendingSubmission(
  idempotencyKey: string
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).delete(idempotencyKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyListeners();
}

let isSyncing = false;

export async function syncPendingSubmissions(): Promise<{
  synced: number;
  failed: number;
}> {
  if (isSyncing) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const items = await listPendingSubmissions();
    for (const item of items) {
      await enqueuePendingSubmission({ ...item, status: "SYNCING", errorMessage: undefined });
      try {
        const fd = new FormData();
        fd.append("idempotency_key", item.idempotencyKey);

        if (item.action === "COMPLETE") {
          for (const img of item.images) {
            fd.append("images", img.blob, img.name);
          }
          if (item.recipientName) fd.append("recipient_name", item.recipientName);
          if (item.driverNotes) fd.append("driver_notes", item.driverNotes);
          if (item.locationConsent && item.latitude && item.longitude) {
            fd.append("latitude", item.latitude);
            fd.append("longitude", item.longitude);
            if (item.locationAccuracyM) {
              fd.append("location_accuracy_m", item.locationAccuracyM);
            }
            fd.append("location_consent", "true");
          } else {
            fd.append("location_consent", "false");
          }
          await api.deliveries.complete(item.deliveryId, fd);
        } else {
          fd.append("reason", item.failureReason || "OTHER");
          if (item.failureNotes) fd.append("notes", item.failureNotes);
          if (item.images[0]) {
            fd.append("image", item.images[0].blob, item.images[0].name);
          }
          await api.deliveries.fail(item.deliveryId, fd);
        }

        await removePendingSubmission(item.idempotencyKey);
        synced += 1;
      } catch (err) {
        failed += 1;
        const msg =
          err instanceof ApiError
            ? err.message
            : "Sync failed. Will retry when connection is stable.";
        await enqueuePendingSubmission({
          ...item,
          status: "ERROR",
          errorMessage: msg,
        });
      }
    }
  } finally {
    isSyncing = false;
  }

  return { synced, failed };
}
