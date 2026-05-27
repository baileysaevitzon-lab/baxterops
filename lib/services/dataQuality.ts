import { list, upsert, where } from "./persistence";
import { TABLES } from "./tables";
import type { DataQualityFlag } from "@/lib/types";

export async function getAllRuntimeFlags(): Promise<DataQualityFlag[]> {
  return list<DataQualityFlag>(TABLES.dataQualityFlags);
}

export async function getFlagsForEntity(entityId: string): Promise<DataQualityFlag[]> {
  return where<DataQualityFlag>(TABLES.dataQualityFlags, f =>
    f.id.includes(entityId) || (f as unknown as { affectedEntityId?: string }).affectedEntityId === entityId,
  );
}

export async function createDataQualityFlag(flag: DataQualityFlag): Promise<DataQualityFlag> {
  flag.createdAt = flag.createdAt || new Date().toISOString();
  return upsert<DataQualityFlag>(TABLES.dataQualityFlags, flag);
}

export async function resolveDataQualityFlag(id: string): Promise<DataQualityFlag | undefined> {
  const flags = await getAllRuntimeFlags();
  const f = flags.find(x => x.id === id);
  if (!f) return undefined;
  f.status = "fixed";
  return upsert<DataQualityFlag>(TABLES.dataQualityFlags, f);
}
