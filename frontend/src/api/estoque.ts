import { apiClient, estoqueApiPath } from './client';

export type StockItemType = 'FILTRO' | 'PRODUTO_QUIMICO';
export type StockMovementType = 'ENTRADA' | 'SAIDA';
export type StockMovementReason =
  | 'COMPRA'
  | 'DEVOLUCAO_OBRA'
  | 'INVENTARIO'
  | 'USO_EM_PROJETO'
  | 'PERDA'
  | 'DESCARTE_VALIDADE'
  | 'ESTORNO';

export interface PdfUpload {
  fileName: string;
  dataUrl: string;
}

export interface StockItemDocument {
  id: string;
  fileName: string;
  mimeType: string;
  publicUrl: string;
  createdAt: string;
}

export interface StockCategory {
  id: string;
  type: StockItemType;
  name: string;
  checklistEnabled: boolean;
  checklistItems: string[];
  isActive: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockCategoryPayload {
  type: StockItemType;
  name: string;
  checklistEnabled?: boolean;
  checklistItems?: string[];
}

export type StockCategoryUpdatePayload = Omit<StockCategoryPayload, 'type'>;

export interface StockItem {
  id: string;
  type: StockItemType;
  categoryId: string | null;
  category: StockCategory | null;
  code: string;
  name: string;
  manufacturer: string | null;
  description: string | null;
  unitLabel: 'un' | 'kg' | 'L';
  minQuantity: string | null;
  location: string | null;
  filterModel: string | null;
  filterKind: string | null;
  filterMicron: string | null;
  unNumber: string | null;
  casNumber: string | null;
  documents: StockItemDocument[];
  checklistEnabled: boolean;
  checklistItems: string[] | null;
  isActive: boolean;
  hasMovements: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockItemPayload {
  type: StockItemType;
  categoryId?: string | null;
  code: string;
  name: string;
  manufacturer?: string | null;
  description?: string | null;
  unitLabel?: 'kg' | 'L';
  minQuantity?: number | string | null;
  location?: string | null;
  filterModel?: string | null;
  filterKind?: string | null;
  filterMicron?: string | null;
  unNumber?: string | null;
  casNumber?: string | null;
  checklistEnabled?: boolean;
  checklistItems?: string[] | null;
}

export type StockItemUpdatePayload = Omit<StockItemPayload, 'type'>;

export interface StockBatchSummary {
  id: string;
  lotNumber: string;
  expiryDate: string | null;
  nfNumber?: string | null;
  supplier?: string | null;
  balance: string;
  expired: boolean;
  expiringSoon?: boolean;
}

export interface StockSummaryItem {
  item: Pick<
    StockItem,
    | 'id'
    | 'code'
    | 'name'
    | 'type'
    | 'unitLabel'
    | 'minQuantity'
    | 'manufacturer'
    | 'description'
    | 'location'
    | 'filterModel'
    | 'filterKind'
    | 'filterMicron'
    | 'unNumber'
    | 'casNumber'
    | 'isActive'
  > & { category: Pick<StockCategory, 'id' | 'name'> | null };
  balance: string;
  belowMin: boolean;
  batches: StockBatchSummary[];
}

export interface StockMovement {
  id: string;
  type: StockMovementType;
  reason: StockMovementReason;
  item: Pick<StockItem, 'id' | 'code' | 'name' | 'unitLabel'>;
  batch: { id: string; lotNumber: string; expiryDate: string | null };
  quantity: string;
  date: string;
  project: { id: string; code: string; name: string } | null;
  nfNumber: string | null;
  supplier: string | null;
  unitCost: string | null;
  requestedBy: string | null;
  notes: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface StockMovementPayload {
  reason: StockMovementReason;
  type?: StockMovementType;
  itemId: string;
  batchId?: string;
  quantity: number | string;
  date: string;
  projectId?: string;
  nfNumber?: string;
  lotNumber?: string;
  expiryDate?: string;
  supplier?: string;
  unitCost?: number | string | null;
  requestedBy?: string;
  notes?: string;
  confirmExpired?: boolean;
}

export interface StockReturnMovementsPayload {
  reason: 'DEVOLUCAO_OBRA';
  projectId: string;
  date: string;
  notes?: string;
  items: Array<{
    itemId: string;
    batchId: string;
    quantity: number | string;
  }>;
}

export interface StockMovementListParams {
  itemId?: string;
  type?: StockMovementType;
  reason?: StockMovementReason;
  projectId?: string;
  from?: string;
  to?: string;
  dateOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function listStockItems(params?: { type?: StockItemType; search?: string; includeInactive?: boolean }) {
  const response = await apiClient.get<{ items: StockItem[] }>(estoqueApiPath('/itens'), { params });
  return response.data.items;
}

export async function listStockCategories(params?: { type?: StockItemType; includeInactive?: boolean }) {
  const response = await apiClient.get<{ categories: StockCategory[] }>(estoqueApiPath('/categorias'), { params });
  return response.data.categories;
}

export async function createStockCategory(payload: StockCategoryPayload) {
  const response = await apiClient.post<StockCategory>(estoqueApiPath('/categorias'), payload);
  return response.data;
}

export async function updateStockCategory(id: string, payload: StockCategoryUpdatePayload) {
  const response = await apiClient.put<StockCategory>(estoqueApiPath(`/categorias/${id}`), payload);
  return response.data;
}

export async function setStockCategoryActive(id: string, isActive: boolean) {
  const response = await apiClient.patch<StockCategory>(estoqueApiPath(`/categorias/${id}/ativo`), { isActive });
  return response.data;
}

export async function removeStockCategory(id: string) {
  await apiClient.delete(estoqueApiPath(`/categorias/${id}`));
}

export async function createStockItem(payload: StockItemPayload) {
  const response = await apiClient.post<StockItem>(estoqueApiPath('/itens'), payload);
  return response.data;
}

export async function updateStockItem(id: string, payload: StockItemUpdatePayload) {
  const response = await apiClient.put<StockItem>(estoqueApiPath(`/itens/${id}`), payload);
  return response.data;
}

export async function setStockItemActive(id: string, isActive: boolean) {
  const response = await apiClient.patch<StockItem>(estoqueApiPath(`/itens/${id}/ativo`), { isActive });
  return response.data;
}

export async function removeStockItem(id: string) {
  await apiClient.delete(estoqueApiPath(`/itens/${id}`));
}

export async function createStockItemDocument(itemId: string, upload: PdfUpload) {
  const response = await apiClient.post<StockItemDocument>(
    estoqueApiPath(`/itens/${itemId}/documentos`),
    upload
  );
  return response.data;
}

export async function removeStockItemDocument(itemId: string, documentId: string) {
  await apiClient.delete(estoqueApiPath(`/itens/${itemId}/documentos/${documentId}`));
}

export async function getStockSummary() {
  const response = await apiClient.get<{ summary: StockSummaryItem[] }>(estoqueApiPath('/resumo'));
  return response.data.summary;
}

export async function listStockMovements(params?: StockMovementListParams) {
  const response = await apiClient.get<{ movements: StockMovement[]; total: number; page: number; pageSize: number }>(
    estoqueApiPath('/movimentacoes'),
    { params }
  );
  return response.data;
}

export async function createStockMovement(payload: StockMovementPayload) {
  const response = await apiClient.post<StockMovement & { balances: { item: string; batch: string } }>(
    estoqueApiPath('/movimentacoes'),
    payload
  );
  return response.data;
}

export async function createStockReturnMovements(payload: StockReturnMovementsPayload) {
  const response = await apiClient.post<{
    movements: Array<StockMovement & { balances: { item: string; batch: string } }>;
  }>(estoqueApiPath('/movimentacoes'), payload);
  return response.data.movements;
}

export async function reverseStockMovement(id: string, notes?: string | null) {
  const response = await apiClient.post<StockMovement>(estoqueApiPath(`/movimentacoes/${id}/estorno`), { notes });
  return response.data;
}

export async function listStockBatches(
  itemId: string,
  params?: { reason?: StockMovementReason; projectId?: string }
) {
  const response = await apiClient.get<{ batches: StockBatchSummary[] }>(estoqueApiPath('/lotes'), {
    params: { itemId, ...params }
  });
  return response.data.batches;
}
