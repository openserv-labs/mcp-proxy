import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { isInitializeRequest, type JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js'
import * as toolManager from './application-manager'
import { createServer } from './server-creator'
import type { AuthenticatedRequest } from '../types'
import {
  parameterTypeSchema,
  type SimplifiedParamSchema,
  type ApplicationToolConfig
} from '../types'
import { RpcCode, McpError } from '../utils/jsonrpc-error'

/* ───────────────────── Transport Storage ───────────────────── */
export const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>,
  sse: {} as Record<string, SSEServerTransport>
}

/* ───────────────────── Helper Functions ───────────────────── */
export const getApplicationName = (req: AuthenticatedRequest): string => {
  const applicationName = req.query?.applicationName as string
  if (!applicationName) {
    throw new McpError(RpcCode.INVALID_REQUEST, 'Application name is required')
  }
  return applicationName
}

// Validate application name and prepare user tools
async function validateAndPrepareUser(
  applicationName: string,
  requestId: string | number | null = null
): Promise<{ applicationLogId: string; toolConfigs: ApplicationToolConfig[] }> {
  if (!(await toolManager.applicationExists(applicationName)))
    throw new McpError(RpcCode.INVALID_REQUEST, 'Invalid application name', requestId)

  // Setup application and get tools
  await toolManager.createApplicationIfNotExists(applicationName)
  const userTools = await toolManager.getToolsForApplication(applicationName)
  const applicationLogId = `app-${applicationName.slice(0, 8)}`

  // Transform tools to the expected format
  const toolConfigs = userTools.map(tool => {
    const paramSchema: SimplifiedParamSchema = {}

    for (const { name, type, description } of tool.parameters) {
      const validatedType = parameterTypeSchema.safeParse(type)
      const paramType = validatedType.success ? validatedType.data : 'string'
      paramSchema[name] = { type: paramType, description }
    }

    return {
      name: tool.name,
      description: tool.description,
      paramSchema
    }
  })

  return { applicationLogId, toolConfigs }
}

/* ───────────────────── Transport Handlers ───────────────────── */
export async function streamableRequestHandler(req: Request, res: Response): Promise<void> {
  const authenticatedReq = req as AuthenticatedRequest
  const sessionId = authenticatedReq.headers['mcp-session-id'] as string | undefined
  const requestBody = authenticatedReq.body as JSONRPCRequest

  // Handle existing session
  if (sessionId && transports.streamable[sessionId]) {
    await transports.streamable[sessionId].handleRequest(req, res, requestBody)
    return
  }

  // Handle new initialization
  if (!sessionId && isInitializeRequest(requestBody)) {
    const applicationName = getApplicationName(authenticatedReq)
    const { applicationLogId, toolConfigs } = await validateAndPrepareUser(
      applicationName,
      requestBody.id
    )

    // Create and configure transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: id => {
        transports.streamable[id] = transport
      }
    })

    transport.onclose = () => {
      if (transport.sessionId) delete transports.streamable[transport.sessionId]
    }

    // Set up request info
    authenticatedReq.applicationLogId = applicationLogId
    authenticatedReq.applicationName = applicationName

    // Connect to server and handle request
    const server = await createServer(
      toolConfigs,
      `mcp-server-${applicationLogId}`,
      applicationName
    )
    await server.connect(transport)
    await transport.handleRequest(req, res, requestBody)
    return
  }

  // Invalid request
  throw new McpError(
    RpcCode.INVALID_REQUEST,
    'Invalid request: Missing session ID or not an Initialize request'
  )
}

export async function legacySseConnect(req: AuthenticatedRequest, res: Response): Promise<void> {
  const applicationName = getApplicationName(req)
  const { applicationLogId, toolConfigs } = await validateAndPrepareUser(applicationName)

  // Create and configure transport
  const transport = new SSEServerTransport('/messages', res)
  const { sessionId } = transport
  transports.sse[sessionId] = transport

  // Cleanup on close
  res.on('close', () => delete transports.sse[sessionId])

  // Connect to server
  const server = await createServer(
    toolConfigs,
    `MCP Server for ${applicationLogId}`,
    applicationName
  )
  await server.connect(transport)
}

export async function legacySseMessageHandler(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string

  if (!sessionId || !transports.sse[sessionId]) {
    throw new McpError(RpcCode.INVALID_REQUEST, 'Invalid or missing session ID')
  }

  await transports.sse[sessionId].handlePostMessage(req, res, req.body)
}

export async function sessionRequestHandler(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined

  if (!sessionId || !transports.streamable[sessionId]) {
    throw new McpError(RpcCode.INVALID_REQUEST, 'Invalid or missing session ID')
  }

  await transports.streamable[sessionId].handleRequest(req, res)
}
