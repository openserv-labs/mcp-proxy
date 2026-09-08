import type { Request, RequestHandler } from 'express'

const MAX_APPLICATION_NAME_LENGTH = 128

/** Only valid behind `requireApplicationName`. */
export const getApplicationNameHeader = (req: Request) =>
  (req.headers['x-application-name'] as string).trim()

export const requireApplicationName: RequestHandler = (req, res, next) => {
  const header = req.headers['x-application-name']

  if (typeof header !== 'string' || !header.trim()) {
    res.status(400).json({ error: 'X-Application-Name header is required' })
    return
  }

  if (header.trim().length > MAX_APPLICATION_NAME_LENGTH) {
    res.status(400).json({
      error: `X-Application-Name must be at most ${MAX_APPLICATION_NAME_LENGTH} characters`
    })
    return
  }

  next()
}
