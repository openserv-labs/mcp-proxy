import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler } from 'express'

import { logger } from '../utils/logger'

const MIN_TOKEN_LENGTH = 16

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

// Hashing first lets timingSafeEqual compare inputs of different lengths.
const secretsMatch = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

const extractBearerToken = (req: Request): string | undefined => {
  const header = req.headers.authorization
  if (typeof header !== 'string') return undefined

  const separator = header.indexOf(' ')
  if (separator === -1) return undefined
  if (header.slice(0, separator).toLowerCase() !== 'bearer') return undefined

  const token = header.slice(separator + 1).trim()
  return token || undefined
}

// Fails closed: with no valid ADMIN_TOKEN every admin request is rejected.
export function requireAdminToken(): RequestHandler {
  const configuredToken = process.env.ADMIN_TOKEN?.trim()

  if (!configuredToken) {
    logger.error(
      'ADMIN_TOKEN is not set - the admin API is disabled. ' +
        'Set ADMIN_TOKEN to a long random secret to enable it.'
    )
  } else if (configuredToken.length < MIN_TOKEN_LENGTH) {
    logger.error(
      `ADMIN_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters - the admin API is disabled. ` +
        'Use a long random secret.'
    )
  }

  const adminToken =
    configuredToken && configuredToken.length >= MIN_TOKEN_LENGTH ? configuredToken : undefined

  return (req, res, next) => {
    if (!adminToken) {
      logger.warn(`Rejected admin request to ${req.originalUrl}: no valid ADMIN_TOKEN configured`)
      res.status(503).json({ error: 'Admin API is disabled: server has no valid ADMIN_TOKEN' })
      return
    }

    const presented = extractBearerToken(req)

    if (!presented || !secretsMatch(presented, adminToken)) {
      logger.warn(
        `Unauthorized admin request to ${req.method} ${req.originalUrl} from ${req.ip ?? 'unknown'}`
      )
      res.set('WWW-Authenticate', 'Bearer realm="mcp-proxy admin"')
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    next()
  }
}
