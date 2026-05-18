// src/db/schema.ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// 招标文件表 (Tender Documents)
// ============================================
export const tenderDocuments = pgTable('tender_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 500 }).notNull(),
  originalName: varchar('original_name', { length: 500 }),
  size: integer('size').notNull(),  // bytes
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  category: varchar('category', { length: 50 }).notNull().default('tender'),  // tender=招标公告, bid=投标文件
  status: varchar('status', { length: 20 }).notNull().default('uploading'),  // uploading, processing, ready, error

  // 加密存储
  encryptedPath: text('encrypted_path').notNull(),  // 加密后的文件存储路径
  encryptionKeyId: varchar('encryption_key_id', { length: 100 }),  // 加密密钥 ID

  // 元数据
  metadata: jsonb('metadata').$type<{
    uploaderIp?: string
    extractionStatus?: 'pending' | 'processing' | 'done' | 'failed'
    elementCount?: number
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // 按状态查询
  statusIdx: index('idx_tender_documents_status').on(table.status),
  // 按创建时间排序
  createdAtIdx: index('idx_tender_documents_created').on(table.createdAt),
}));

// ============================================
// 分析结果表 (Analysis Results)
// ============================================
export const analysisResults = pgTable('analysis_results', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 关联的招标文件
  documentId: uuid('document_id').notNull().references(() => tenderDocuments.id, { onDelete: 'cascade' }),

  // 分析类型
  type: varchar('type', { length: 50 }).notNull(),  // element_extract, opening_analysis, simulated_doc

  // 分析状态
  status: varchar('status', { length: 20 }).notNull().default('pending'),  // pending, processing, done, failed

  // 分析结果（JSONB 存储结构化数据）
  result: jsonb('result').$type<{
    elements?: Array<{
      name: string
      content: string
      confidence?: number
    }>
    statistics?: {
      ranking?: number[]
      priceChange?: number[]
      dispersion?: number
    }
    summary?: string
  }>(),

  // 使用的 AI 模型
  model: varchar('model', { length: 100 }),
  provider: varchar('provider', { length: 50 }),

  // 错误信息
  error: text('error'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // 按文档查询
  documentIdx: index('idx_analysis_results_document').on(table.documentId),
  // 按类型查询
  typeIdx: index('idx_analysis_results_type').on(table.type),
}));

// ============================================
// AI 配置表 (AI Provider Configurations)
// ============================================
export const aiConfigurations = pgTable('ai_configurations', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 供应商名称
  provider: varchar('provider', { length: 50 }).notNull(),  // openai, deepseek, claude, etc.
  model: varchar('model', { length: 100 }).notNull(),

  // API 配置（实际密钥存在环境变量，这里只存引用）
  apiKeyRef: varchar('api_key_ref', { length: 200 }),
  apiEndpoint: varchar('api_endpoint', { length: 500 }),

  // 配置状态
  isActive: boolean('is_active').notNull().default(false),
  isTested: boolean('is_tested').notNull().default(false),
  lastTestedAt: timestamp('last_tested_at'),
  lastTestResult: jsonb('last_test_result').$type<{
    success: boolean
    latencyMs?: number
    error?: string
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // 唯一约束：一个时刻只能有一个活跃配置
  providerUnique: uniqueIndex('uniq_ai_config_provider').on(table.provider),
}));

// ============================================
// 提取要素表 (Extracted Elements) - 冗余存储加速查询
// ============================================
export const extractedElements = pgTable('extracted_elements', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 关联的分析结果
  analysisId: uuid('analysis_id').notNull().references(() => analysisResults.id, { onDelete: 'cascade' }),

  // 要素名称
  name: varchar('name', { length: 100 }).notNull(),  // 资质要求, 评标办法, 业绩门槛, 定标方法, 合同条款

  // 要素内容
  content: text('content').notNull(),

  // 可信度
  confidence: integer('confidence'),  // 0-100

  // 位置信息（可选）
  position: jsonb('position').$type<{
    page?: number
    startLine?: number
    endLine?: number
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // 按分析结果查询
  analysisIdx: index('idx_extracted_elements_analysis').on(table.analysisId),
  // 按类型查询
  nameIdx: index('idx_extracted_elements_name').on(table.name),
}));

// ============================================
// 统计计算表 (Statistics) - 开标分析结果
// ============================================
export const statistics = pgTable('statistics', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 关联的分析结果
  analysisId: uuid('analysis_id').notNull().references(() => analysisResults.id, { onDelete: 'cascade' }),

  // 统计数据（JSONB 存储）
  data: jsonb('data').$type<{
    // 报价数据
    prices?: number[]
    priceRankings?: Array<{ bidderId: string; price: number; rank: number }>

    // 统计指标
    averagePrice?: number
    lowestPrice?: number
    highestPrice?: number
    dispersionCoefficient?: number  // 离散系数

    // 降价幅度
    priceChanges?: number[]
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  analysisIdx: index('idx_statistics_analysis').on(table.analysisId),
}));

// ============================================
// 文件下载记录表 (Download Logs)
// ============================================
export const downloadLogs = pgTable('download_logs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 下载的文件
  documentId: uuid('document_id').notNull().references(() => tenderDocuments.id, { onDelete: 'cascade' }),

  // 下载来源（web, api）
  source: varchar('source', { length: 20 }).notNull().default('web'),

  // 下载 IP
  ipAddress: varchar('ip_address', { length: 50 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  documentIdx: index('idx_download_logs_document').on(table.documentId),
  createdAtIdx: index('idx_download_logs_created').on(table.createdAt),
}));

// ============================================
// 系统配置表 (System Configurations)
// ============================================
export const systemConfigurations = pgTable('system_configurations', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 配置键
  key: varchar('key', { length: 100 }).notNull().unique(),

  // 配置值
  value: text('value'),

  // 描述
  description: varchar('description', { length: 500 }),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// 审计日志表 (Audit Logs)
// ============================================
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 操作类型
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),

  // 操作详情
  details: jsonb('details'),

  // 来源 IP
  ipAddress: varchar('ip_address', { length: 50 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // 按实体查询
  entityIdx: index('idx_audit_logs_entity').on(table.entityType, table.entityId),
  // 按时间查询
  createdAtIdx: index('idx_audit_logs_created').on(table.createdAt),
}));

// ============================================
// 用户表 (Users)
// ============================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 200 }),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  usernameIdx: uniqueIndex('uniq_users_username').on(table.username),
}));

export const usersRelations = relations(users, ({ many }) => ({
  downloadLogs: many(downloadLogs),
  auditLogs: many(auditLogs),
}));

// ============================================
// Relations
// ============================================
export const tenderDocumentsRelations = relations(tenderDocuments, ({ many }) => ({
  analysisResults: many(analysisResults),
  downloadLogs: many(downloadLogs),
}));

export const analysisResultsRelations = relations(analysisResults, ({ one, many }) => ({
  document: one(tenderDocuments, {
    fields: [analysisResults.documentId],
    references: [tenderDocuments.id],
  }),
  extractedElements: many(extractedElements),
  statistics: many(statistics),
}));

export const extractedElementsRelations = relations(extractedElements, ({ one }) => ({
  analysis: one(analysisResults, {
    fields: [extractedElements.analysisId],
    references: [analysisResults.id],
  }),
}));

export const statisticsRelations = relations(statistics, ({ one }) => ({
  analysis: one(analysisResults, {
    fields: [statistics.analysisId],
    references: [analysisResults.id],
  }),
}));

export const downloadLogsRelations = relations(downloadLogs, ({ one }) => ({
  document: one(tenderDocuments, {
    fields: [downloadLogs.documentId],
    references: [tenderDocuments.id],
  }),
}));