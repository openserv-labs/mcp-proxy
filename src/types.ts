import type { Request } from 'express'
import { z } from 'zod'

// Base parameter types
export type ParameterType = 'string' | 'number' | 'boolean'
export const parameterTypeSchema = z.enum(['string', 'number', 'boolean'])

// Parameter configuration schemas
export const paramConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: parameterTypeSchema,
  description: z.string()
})

// Tool parameter for simplified API
export const paramSchemaItemSchema = z.object({
  type: parameterTypeSchema,
  description: z.string()
})

export const simplifiedParamSchemaSchema = z.record(paramSchemaItemSchema)

// Tool schemas
export const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.array(paramConfigSchema)
})

export const applicationToolConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  paramSchema: simplifiedParamSchemaSchema
})

// Response schema for tool responses
export const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
})

export const proxyResponseSchema = z.object({
  content: z.array(textContentSchema)
})

// User schema
export const applicationSchema = z.object({
  applicationName: z.string().min(1),
  backendUrl: z.string().url().optional(),
  tools: z.array(toolSchema)
})

// Infer types from schemas
export type ParamConfig = z.infer<typeof paramConfigSchema>
export type Tool = z.infer<typeof toolSchema>
export type Application = z.infer<typeof applicationSchema>
export type SimplifiedParamSchema = z.infer<typeof simplifiedParamSchemaSchema>
export type ApplicationToolConfig = z.infer<typeof applicationToolConfigSchema>
export type ProxyResponse = z.infer<typeof proxyResponseSchema>
export type TextContent = z.infer<typeof textContentSchema>

// Extend Request type for authenticated user
export interface AuthenticatedRequest extends Request {
  applicationName?: string
  applicationLogId?: string
}
