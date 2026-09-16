export type ScopeServiceItem = {
  id: string;
  title: string;
  description: string;
  /** Texto integral, sem acrescentar título ou abertura ao imprimir. */
  format?: "paragraph";
  subitems?: string[];
};

export type ScopeTableBlock = {
  id: string;
  type: "table";
  scopeItemId?: string;
  title: string;
  columns: string[];
  rows: string[][];
};

export type ScopePhotoBlock = {
  id: string;
  type: "photo";
  scopeItemId?: string;
  assetKey: string;
  src: string;
  fileName: string;
  caption: string;
  aspectRatio: number;
};

export type ScopeBlock = ScopeTableBlock | ScopePhotoBlock;

export type ScopeServiceSection = ScopeServiceItem & {
  blocks: ScopeBlock[];
  legacy: boolean;
};

export const MAX_SCOPE_SERVICE_ITEMS = 20;
export const MAX_SCOPE_SERVICE_TITLE_CHARACTERS = 160;
export const MAX_SCOPE_SERVICE_DESCRIPTION_CHARACTERS = 12_000;
export const MAX_SCOPE_SERVICE_SUBITEMS = 20;
export const MAX_SCOPE_PHOTOS = 8;
export const MAX_SCOPE_TABLES = 8;
export const MAX_SCOPE_TABLE_COLUMNS = 6;
export const MAX_SCOPE_TABLE_ROWS = 40;
export const MAX_SCOPE_TABLE_CELL_CHARACTERS = 300;

export function createScopeServiceItem(id: string, index = 0): ScopeServiceItem {
  return {
    id,
    title: `Serviço ${index + 1}`,
    description: "",
  };
}

export function createScopeTableBlock(
  id: string,
  scopeItemId?: string,
): ScopeTableBlock {
  return {
    id,
    type: "table",
    ...(cleanId(scopeItemId) ? { scopeItemId: cleanId(scopeItemId) } : {}),
    title: "Tabela do escopo",
    columns: ["Item", "Descrição"],
    rows: [["1", ""]],
  };
}

export function normalizeScopeServiceItems(value: unknown): ScopeServiceItem[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  const items: ScopeServiceItem[] = [];
  for (const candidate of value) {
    if (items.length >= MAX_SCOPE_SERVICE_ITEMS) break;
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const id = cleanId(record.id);
    if (!id || usedIds.has(id)) continue;
    usedIds.add(id);
    const title = String(record.title ?? record.name ?? "").trim()
      .slice(0, MAX_SCOPE_SERVICE_TITLE_CHARACTERS);
    const description = String(
      record.description ?? record.text ?? record.serviceDescription ?? "",
    ).trim().slice(0, MAX_SCOPE_SERVICE_DESCRIPTION_CHARACTERS);
    items.push({
      id,
      title: title || `Serviço ${items.length + 1}`,
      description,
      ...(record.format === "paragraph" ? { format: "paragraph" as const } : {}),
      ...(Array.isArray(record.subitems) ? {
        subitems: record.subitems.slice(0, MAX_SCOPE_SERVICE_SUBITEMS)
          .filter((text): text is string => typeof text === "string")
          .map(text => text.trim().slice(0, MAX_SCOPE_SERVICE_DESCRIPTION_CHARACTERS)),
      } : {}),
    });
  }
  return items;
}

export function normalizeScopeBlocks(value: unknown): ScopeBlock[] {
  if (!Array.isArray(value)) return [];
  let tableCount = 0;
  let photoCount = 0;
  return value.flatMap<ScopeBlock>((candidate): ScopeBlock[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const id = cleanId(record.id);
    if (!id) return [];
    const scopeItemId = cleanId(record.scopeItemId);

    if (record.type === "table") {
      if (tableCount >= MAX_SCOPE_TABLES) return [];
      const columns = Array.isArray(record.columns)
        ? record.columns.slice(0, MAX_SCOPE_TABLE_COLUMNS).map((column) => String(column || "").slice(0, 80))
        : [];
      if (columns.length < 2) return [];
      const rows = Array.isArray(record.rows)
        ? record.rows.slice(0, MAX_SCOPE_TABLE_ROWS).map((row) => {
            const cells = Array.isArray(row) ? row : [];
            return columns.map((_, index) => String(cells[index] || "").slice(0, MAX_SCOPE_TABLE_CELL_CHARACTERS));
          })
        : [];
      tableCount += 1;
      return [{
        id,
        type: "table",
        ...(scopeItemId ? { scopeItemId } : {}),
        title: String(record.title || "Tabela do escopo").slice(0, 120),
        columns,
        rows: rows.length ? rows : [columns.map(() => "")],
      } satisfies ScopeTableBlock];
    }

    if (record.type === "photo") {
      if (photoCount >= MAX_SCOPE_PHOTOS) return [];
      const assetKey = String(record.assetKey || "").trim();
      const src = String(record.src || "").trim();
      if (!assetKey.startsWith("scope/") || !src.startsWith("/api/scope-assets?key=")) return [];
      photoCount += 1;
      return [{
        id,
        type: "photo",
        ...(scopeItemId ? { scopeItemId } : {}),
        assetKey,
        src,
        fileName: String(record.fileName || "Foto do escopo").slice(0, 180),
        caption: String(record.caption || "").slice(0, 240),
        aspectRatio: clampAspectRatio(Number(record.aspectRatio)),
      } satisfies ScopePhotoBlock];
    }
    return [];
  });
}

export function resolveScopeServiceSections(input: {
  scopeItems: unknown;
  scopeBlocks: unknown;
  legacyDescription?: unknown;
  legacyScope?: unknown;
}): ScopeServiceSection[] {
  const items = normalizeScopeServiceItems(input.scopeItems);
  const blocks = normalizeScopeBlocks(input.scopeBlocks);
  if (!items.length) {
    return [{
      id: "__legacy_scope__",
      title: "",
      description: cleanText(input.legacyDescription)
        || cleanText(input.legacyScope)
        || "Serviços conforme escopo apresentado.",
      blocks,
      legacy: true,
    }];
  }
  return items.map((item, index) => ({
    ...item,
    blocks: blocks.filter((block) =>
      block.scopeItemId === item.id
      || (index === 0 && !block.scopeItemId)),
    legacy: false,
  }));
}

export function countScopePhotos(blocks: ScopeBlock[]) {
  return blocks.filter((block) => block.type === "photo").length;
}

export function countScopeTables(blocks: ScopeBlock[]) {
  return blocks.filter((block) => block.type === "table").length;
}

function clampAspectRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 4 / 3;
  return Math.min(5, Math.max(0.2, value));
}

function cleanId(value: unknown) {
  return String(value ?? "").trim().slice(0, 160);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}
