import 'dotenv/config'
import express, { type Request, type Response, type ErrorRequestHandler } from 'express'
import path from 'node:path'
import cors from 'cors'

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

export async function bootstrap() {
  await initializeDatabase()

  const app = express()

  app.use(cors())
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
  const errorHandler: ErrorRequestHandler = (err, _req, res) => {
    if (err instanceof McpError) {
      logger.warn(`MCP Error: ${err.message}`)
      res.status(err.httpStatus).json(err)
      return
    }
    logger.error('Unexpected error', err)
  }

  app.use(errorHandler)

  /* ─────────────── Server startup ─────────────── */
  const port = Number(process.env.PORT) || 3000
  const server = app.listen(port, () => {
    logger.info(`MCP server running at http://localhost:${port}`)
    logger.info(`Admin UI        : http://localhost:${port}/admin`)
    logger.info(`HTTP transport  : http://localhost:${port}/mcp`)
    logger.info(`SSE transport   : http://localhost:${port}/sse`)
  })

  return { app, server }
}

if (process.argv[1] === __filename) {
  bootstrap().catch(err => {
    logger.error(err, 'Failed to start server')
    process.exit(1)
  })
}
