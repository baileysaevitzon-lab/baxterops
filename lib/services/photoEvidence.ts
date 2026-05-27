import { list, upsert, upsertMany, where, remove } from "./persistence";
import { TABLES } from "./tables";
import type { PhotoEvidenceRecord } from "@/lib/types";

export async function getCompetitorPhotoEvidence(competitorId: string): Promise<PhotoEvidenceRecord[]> {
  const rows = await where<PhotoEvidenceRecord>(TABLES.photoEvidence, p => p.competitorId === competitorId);
  return rows.sort((a, b) => a.photoOrder - b.photoOrder);
}

export async function getPhotoCollection(collectionId: string): Promise<PhotoEvidenceRecord[]> {
  const rows = await where<PhotoEvidenceRecord>(TABLES.photoEvidence, p => p.collectionId === collectionId);
  return rows.sort((a, b) => a.photoOrder - b.photoOrder);
}

export async function getAllPhotoEvidence(): Promise<PhotoEvidenceRecord[]> {
  return list<PhotoEvidenceRecord>(TABLES.photoEvidence);
}

export async function upsertPhotoEvidence(p: PhotoEvidenceRecord): Promise<PhotoEvidenceRecord> {
  p.updatedAt = new Date().toISOString();
  return upsert<PhotoEvidenceRecord>(TABLES.photoEvidence, p);
}

export async function bulkUpsertPhotoEvidence(rows: PhotoEvidenceRecord[]): Promise<PhotoEvidenceRecord[]> {
  return upsertMany<PhotoEvidenceRecord>(TABLES.photoEvidence, rows);
}

export async function deletePhotoEvidence(id: string): Promise<void> {
  await remove(TABLES.photoEvidence, id);
}

/**
 * Attach a stored image (storagePath or publicUrl) to the placeholder record
 * for a given photo order. Used after Bailey converts the .heic files and
 * drops them into public/zen-tour/.
 */
export async function attachStoredImage(collectionId: string, photoOrder: number, storagePath: string, publicUrl?: string): Promise<PhotoEvidenceRecord | undefined> {
  const rows = await getPhotoCollection(collectionId);
  const target = rows.find(r => r.photoOrder === photoOrder);
  if (!target) return undefined;
  target.storagePath = storagePath;
  target.publicUrl = publicUrl;
  return upsertPhotoEvidence(target);
}
