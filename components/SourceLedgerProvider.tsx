"use client";
// Sprint 6 — shared ledger cache so SourceBadge doesn't fire N requests per page.
//
// Strategy:
//   - On first mount, fetch the entire ledger (113 rows is tiny).
//   - Index by (entityType, entityId, fieldKey).
//   - Provide getLedgerRow() so badges read from memory.
//   - Expose refresh() so callers can re-pull after a save.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { getAllLedger } from "@/lib/services/sourceLedger";
import type { DataSourceLedgerRow } from "@/lib/types";

interface Ctx {
  rows: DataSourceLedgerRow[];
  byKey: Map<string, DataSourceLedgerRow>;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const SourceLedgerCtx = createContext<Ctx | null>(null);

function makeKey(entityType: string, entityId: string, fieldKey: string) {
  return `${entityType}::${entityId}::${fieldKey}`;
}

export function SourceLedgerProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<DataSourceLedgerRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await getAllLedger();
      setRows(r);
    } catch (e) {
      console.warn("[SourceLedgerProvider] fetch failed:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const byKey = new Map<string, DataSourceLedgerRow>();
  for (const r of rows) byKey.set(makeKey(r.entityType, r.entityId, r.fieldKey), r);

  return (
    <SourceLedgerCtx.Provider value={{ rows, byKey, loaded, refresh }}>
      {children}
    </SourceLedgerCtx.Provider>
  );
}

export function useSourceLedger(): Ctx | null {
  return useContext(SourceLedgerCtx);
}

export function useLedgerRow(entityType: string, entityId: string, fieldKey: string): DataSourceLedgerRow | undefined {
  const ctx = useContext(SourceLedgerCtx);
  if (!ctx) return undefined;
  return ctx.byKey.get(makeKey(entityType, entityId, fieldKey));
}
