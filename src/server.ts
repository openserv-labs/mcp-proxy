import 'dotenv/config'
import express, { type Request, type Response, type ErrorRequestHandler } from 'express'
import path from 'node:path'
import cors, { type CorsOptions } from 'cors'

import adminRoutes from './routes/admin.js'
import {
  streamableRequestHandler,
  sessionRequestHandler,
  legacySseConnect,
  legacySseMessageHandler
} from './services/transport-manager.js'
import { initializeDatabase } from './database/index.js'
import { logger } from './utils/logger.js'
import { McpError } from './utils/jsonrpc-error.js'

// CORS_ORIGINS is a comma-separated list of allowed origins; "*" allows any.
// With nothing configured no CORS headers are sent.
function corsOptions(): CorsOptions {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  let origin: CorsOptions['origin'] = false

  if (configured.includes('*')) {
    logger.warn('CORS_ORIGINS is "*" - any website may call this server from a browser')
    origin = true
  } else if (configured.length > 0) {
    origin = configured
  }

  return {
    origin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Mcp-Session-Id'],
    maxAge: 600
  }
}

export async function bootstrap() {
  await initializeDatabase()

  const app = express()

  app.use(cors(corsOptions()))
  app.use(express.json())

  /* ─────────────── Static Files ─────────────── */
  app.use(express.static(path.join(__dirname, '../public')))

  /* ─────────────── View engine (PUG) ─────────────── */
  app.set('views', path.join(__dirname, 'views'))
  app.set('view engine', 'pug')

  /* ─────────────── Routes ─────────────── */
  app.use('/admin', adminRoutes)
  app.get('/', (_: Request, res: Response) => res.render('home'))

  // Model Context Protocol transports
  app
    .route('/mcp')
    .post(streamableRequestHandler)
    .get(sessionRequestHandler)
    .delete(sessionRequestHandler)

  app.get('/sse', legacySseConnect)
  app.post('/messages', legacySseMessageHandler)

  /* ─────────────── Error handling ─────────────── */
  const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err)
      return
    }

    if (err instanceof McpError) {
      logger.warn(`MCP Error: ${err.message}`)
      res.status(err.httpStatus).json(err)
      return
    }

    logger.error(err, 'Unexpected error')
    res.status(500).json({ error: 'Internal server error' })
  }

  app.use(errorHandler)

  /* ─────────────── Server startup ─────────────── */
  const port = Number(process.env.PORT) || 3000
  const host = process.env.HOST?.trim() || '127.0.0.1'

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    logger.warn(
      `Binding to ${host} exposes this server beyond localhost. ` +
        'Make sure ADMIN_TOKEN is set and the port is firewalled appropriately.'
    )
  }

  const server = app.listen(port, host, () => {
    const baseUrl = `http://${host.includes(':') ? `[${host}]` : host}:${port}`
    logger.info(`MCP server running at ${baseUrl}`)
    logger.info(`Admin UI        : ${baseUrl}/admin`)
    logger.info(`HTTP transport  : ${baseUrl}/mcp`)
    logger.info(`SSE transport   : ${baseUrl}/sse`)
  })

  return { app, server }
}

if (process.argv[1] === __filename) {
  bootstrap().catch(err => {
    logger.error(err, 'Failed to start server')
    process.exit(1)
  })
}
