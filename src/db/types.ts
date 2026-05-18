// src/db/types.ts
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import {
  tenderDocuments,
  analysisResults,
  aiConfigurations,
  extractedElements,
  statistics,
  downloadLogs,
  systemConfigurations,
  auditLogs
} from './schema';
import type { relations } from 'drizzle-orm';

// ============================================
// Document Types
// ============================================
export type TenderDocument = InferSelectModel<typeof tenderDocuments>;
export type NewTenderDocument = InferInsertModel<typeof tenderDocuments>;

// ============================================
// Analysis Types
// ============================================
export type AnalysisResult = InferSelectModel<typeof analysisResults>;
export type NewAnalysisResult = InferInsertModel<typeof analysisResults>;

// ============================================
// AI Config Types
// ============================================
export type AIConfiguration = InferSelectModel<typeof aiConfigurations>;
export type NewAIConfiguration = InferInsertModel<typeof aiConfigurations>;

// ============================================
// Element Types
// ============================================
export type ExtractedElement = InferSelectModel<typeof extractedElements>;
export type NewExtractedElement = InferInsertModel<typeof extractedElements>;

// ============================================
// Statistics Types
// ============================================
export type Statistic = InferSelectModel<typeof statistics>;
export type NewStatistic = InferInsertModel<typeof statistics>;

// ============================================
// Log Types
// ============================================
export type DownloadLog = InferSelectModel<typeof downloadLogs>;
export type AuditLog = InferSelectModel<typeof auditLogs>;

// ============================================
// Config Types
// ============================================
export type SystemConfiguration = InferSelectModel<typeof systemConfigurations>;

// ============================================
// Enums
// ============================================
export type DocumentCategory = 'tender' | 'bid';
export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'error';
export type AnalysisType = 'element_extract' | 'opening_analysis' | 'simulated_doc';
export type AnalysisStatus = 'pending' | 'processing' | 'done' | 'failed';
export type ElementName = '资质要求' | '评标办法' | '业绩门槛' | '定标方法' | '合同条款';

// ============================================
// API Response Types
// ============================================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface FileUploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  status: DocumentStatus;
  createdAt: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  active: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latencyMs?: number;
  error?: string;
}

// ============================================
// Element Types
// ============================================
export interface Element {
  name: ElementName;
  content: string;
  confidence?: number;
  position?: {
    page?: number;
    startLine?: number;
    endLine?: number;
  };
}

export interface StatisticsData {
  prices?: number[];
  priceRankings?: Array<{
    bidderId: string;
    price: number;
    rank: number;
  }>;
  averagePrice?: number;
  lowestPrice?: number;
  highestPrice?: number;
  dispersionCoefficient?: number;
  priceChanges?: number[];
}

// ============================================
// SSE Stream Events
// ============================================
export type StreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'element'; data: Element }
  | { type: 'statistics'; data: StatisticsData }
  | { type: 'done'; data: { summary: string; elementCount?: number } }
  | { type: 'error'; data: { message: string } };