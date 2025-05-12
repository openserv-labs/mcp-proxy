import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ZodRawShape } from 'zod'
import * as toolManager from './application-manager'
import {
  type SimplifiedParamSchema,
  type ApplicationToolConfig,
  type ProxyResponse,
  proxyResponseSchema
} from '../types'
import { RpcCode, McpError } from '../utils/jsonrpc-error'

// Handler for forwarding requests to backend
const proxyHandler = async (
  args: Record<string, unknown>,
  context: { applicationName: string; toolName: string }
): Promise<ProxyResponse> => {
  const { applicationName, toolName } = context

  try {
    const backendUrl = await toolManager.getBackendUrl(applicationName)
    if (!backendUrl) {
      throw new McpError(
        RpcCode.INTERNAL_ERROR,
        'Backend URL not configured. Please set a backend URL in the admin interface.'
      )
    }

    const baseUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl
    const endpointUrl = `${baseUrl}/${toolName}`

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Application-Name': applicationName
      },
      body: JSON.stringify(args)
    })

    if (!response.ok) {
      throw new McpError(
        RpcCode.INTERNAL_ERROR,
        `Backend request to "${toolName}" failed with ${response.status} ${response.statusText}`
      )
    }

    const responseData = await response.json()

    const validatedResponse = proxyResponseSchema.safeParse(responseData)

    if (validatedResponse.success) {
      return validatedResponse.data
    }

    // Backend response not in expected Zod format, wrapping response.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(responseData, null, 2)
        }
      ]
    }
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error
    }
    throw new McpError(
      RpcCode.INTERNAL_ERROR,
      `Proxy request to tool "${toolName}" failed: ${error}`
    )
  }
}

// Helper to create Zod schema from simplified definition
function createZodShape(simplifiedSchema: SimplifiedParamSchema): ZodRawShape {
  const shape: ZodRawShape = {}

  for (const [key, param] of Object.entries(simplifiedSchema)) {
    // Map parameter type to appropriate Zod validator
    const validator =
      {
        string: z.string(),
        number: z.number(),
        boolean: z.boolean()
      }[param.type] || z.string()

    // Add description
    shape[key] = validator.describe(param.description)
  }

  return shape
}

// Create MCP server with dynamic tools
export async function createServer(
  applicationToolsConfig: ApplicationToolConfig[],
  serverName: string,
  applicationName: string
): Promise<McpServer> {
  const server = new McpServer({
    name: serverName,
    version: '1.0.0',
    capabilities: { resources: {}, tools: {} }
  })

  for (const toolConfig of applicationToolsConfig) {
    const zodShape = createZodShape(toolConfig.paramSchema)

    // Create a wrapper for the handler that includes the application name in the context
    const handlerWithContext = async (args: Record<string, unknown>) => {
      return proxyHandler(args, {
        applicationName,
        toolName: toolConfig.name
      })
    }

    server.tool(toolConfig.name, toolConfig.description, zodShape, handlerWithContext)
  }
  return server
}
