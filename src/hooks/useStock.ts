// Stock management hooks for API integration
// Hooks for stock deliveries, counts, and adjustments

import { useState } from 'preact/hooks';
import { ApiError, apiPostJson } from '../api';
import type { StockChangeRequest, StockChangeResponse } from '../../shared/contracts';

// ============================================================================
// Stock Request Types
// ============================================================================

export interface StockDeliveryItem {
  readonly productId: number;
  readonly quantity: number;
}

export interface StockDeliveryRequest {
  readonly items: readonly StockDeliveryItem[];
}

export interface StockCountRequest {
  readonly productId: number;
  readonly countedQuantity: number;
  readonly note?: string;
}

export interface StockAdjustmentRequest {
  readonly productId: number;
  readonly reason: string;
  readonly quantity: number;
  readonly note?: string;
}

// ============================================================================
// Stock Delivery Hook
// ============================================================================

export interface StockDeliveryResponse {
  readonly ok: boolean;
  readonly entries: readonly {
    readonly productId: number;
    readonly productName: string;
    readonly quantityReceived: number;
    readonly newQuantity: number;
  }[];
  readonly entryNumber: string;
  readonly stockEntryId: number;
}

export interface UseStockDeliveryResult {
  readonly execute: (request: StockDeliveryRequest) => Promise<StockDeliveryResponse | null>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly result: StockDeliveryResponse | null;
}

export function useStockDelivery() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockDeliveryResponse | null>(null);

  const execute = async (request: StockDeliveryRequest): Promise<StockDeliveryResponse | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPostJson<StockDeliveryResponse>('/stock/delivery', request);
      setResult(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save stock delivery';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    execute,
    loading,
    error,
    result,
  };
}

// ============================================================================
// Stock Count Hook
// ============================================================================

export interface StockCountItem {
  readonly productId: number;
  readonly productName: string;
  readonly oldQuantity: number;
  readonly newQuantity: number;
  readonly delta: number;
}

export interface StockCountResponse {
  readonly ok: boolean;
  readonly productId: number;
  readonly productName: string;
  readonly oldQuantity: number;
  readonly newQuantity: number;
  readonly delta: number;
  readonly note: string | null;
  readonly movementId: number;
}

export interface UseStockCountResult {
  readonly execute: (request: StockCountRequest) => Promise<StockCountResponse | null>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly result: StockCountResponse | null;
}

export function useStockCount() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockCountResponse | null>(null);

  const execute = async (request: StockCountRequest): Promise<StockCountResponse | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPostJson<StockCountResponse>('/stock/count', request);
      setResult(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save stock count';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    execute,
    loading,
    error,
    result,
  };
}

// ============================================================================
// Stock Adjustment Hook
// ============================================================================

export interface StockAdjustmentItem {
  readonly productId: number;
  readonly productName: string;
  readonly oldQuantity: number;
  readonly newQuantity: number;
  readonly delta: number;
  readonly reason: string;
}

export interface StockAdjustmentResponse {
  readonly ok: boolean;
  readonly productId: number;
  readonly productName: string;
  readonly oldQuantity: number;
  readonly newQuantity: number;
  readonly delta: number;
  readonly reason: string;
  readonly note: string | null;
  readonly movementId: number;
}

export interface UseStockAdjustmentResult {
  readonly execute: (request: StockAdjustmentRequest) => Promise<StockAdjustmentResponse | null>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly result: StockAdjustmentResponse | null;
}

export function useStockAdjustment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockAdjustmentResponse | null>(null);

  const execute = async (request: StockAdjustmentRequest): Promise<StockAdjustmentResponse | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPostJson<StockAdjustmentResponse>('/stock/adjustment', request);
      setResult(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save stock adjustment';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    execute,
    loading,
    error,
    result,
  };
}

export function useStockChange() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockChangeResponse | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const execute = async (request: StockChangeRequest): Promise<StockChangeResponse | null> => {
    setLoading(true);
    setError(null);
    setResult(null);
    setErrorStatus(null);

    try {
      const data = await apiPostJson<StockChangeResponse>('/stock/change', request);
      setResult(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change stock';
      setError(message);
      setErrorStatus(err instanceof ApiError ? err.status : null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { execute, loading, error, errorStatus, isConflict: errorStatus === 409, result };
}
