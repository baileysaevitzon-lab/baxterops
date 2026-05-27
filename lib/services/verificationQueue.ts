// Sprint 5 — Manual verification queue.
// Used for sources that block automated WebFetch (Apartments.com, Zillow, etc.).
// Bailey opens the URL in a real browser, pastes the relevant text or uploads
// a screenshot, and confirms or rejects each pending entry.

import { list, upsert, where, remove } from "./persistence";
import { TABLES } from "./tables";
import type { ManualVerificationQueueRow } from "@/lib/types";

export async function getAllQueueItems(): Promise<ManualVerificationQueueRow[]> {
  return list<ManualVerificationQueueRow>(TABLES.manualVerificationQueue);
}

export async function getPendingQueueItems(): Promise<ManualVerificationQueueRow[]> {
  return where<ManualVerificationQueueRow>(TABLES.manualVerificationQueue, q => q.status === "pending" || q.status === "in_progress");
}

export async function upsertQueueItem(row: ManualVerificationQueueRow): Promise<ManualVerificationQueueRow> {
  return upsert<ManualVerificationQueueRow>(TABLES.manualVerificationQueue, row);
}

export async function deleteQueueItem(id: string): Promise<void> {
  return remove(TABLES.manualVerificationQueue, id);
}
