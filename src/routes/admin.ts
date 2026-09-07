import express from 'express'
import type { Request } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'

import * as applications from '../services/application-manager'
import { checkBackendUrl } from '../services/backend-url'
import { requireAdminToken } from '../middleware/admin-auth'
import { getApplicationNameHeader, requireApplicationName } from '../middleware/application-name'
import type { Tool } from '../types'

const router = express.Router()

// ───────────────────────── Helpers ─────────────────────────
const getAppName = (req: Request) => getApplicationNameHeader(req)

// ───────────────────────── Views ───────────────────────────
router.get('/', (_req, res) => res.render('admin'))

// ───────────────────────── Guards ──────────────────────────
router.use('/api', requireAdminToken(), requireApplicationName)

// ─────────────────── API: Application profile ─────────────────────
router.get('/api/application', async (req, res) => {
  const application = await applications.getApplicationByName(getAppName(req))
  res.json({
    backendUrl: application?.backendUrl ?? '',
    tools: (application?.tools ?? []) as Tool[]
  })
})

router.post('/api/application', async (req, res) => {
  const applicationName = getAppName(req)
  const { backendUrl } = req.body as { backendUrl?: unknown }

  if (backendUrl !== undefined && typeof backendUrl !== 'string') {
    res.status(400).json({ error: 'backendUrl must be a string' })
    return
  }

  let validated: string | undefined
  if (backendUrl?.trim()) {
    const check = checkBackendUrl(backendUrl)
    if (!check.ok) {
      res.status(400).json({ error: `Invalid backend URL: ${check.reason}` })
      return
    }
    validated = check.url.href
  }

  // An explicit "" clears the stored URL; omitting the field leaves it untouched.
  const nextBackendUrl = backendUrl === undefined ? undefined : (validated ?? '')

  if (await applications.applicationExists(applicationName)) {
    if (nextBackendUrl !== undefined) {
      await applications.updateBackendUrl(applicationName, nextBackendUrl)
    }
  } else {
    await applications.createApplication(applicationName, validated)
  }
  res.sendStatus(204)
})

// ─────────────────── API: Tools ────────────────────────────
router.get('/api/tools', async (req, res) => {
  const tools = await applications.getToolsForApplication(getAppName(req))
  res.json(tools)
})

router.post('/api/tools', async (req, res) => {
  const applicationName = getAppName(req)
  if (!(await applications.applicationExists(applicationName))) {
    res.status(400).json({ error: 'Application profile missing' })
    return
  }
  await applications.addToolForApplication(applicationName, req.body as Tool)
  res.status(201).json({ success: true })
})

interface NameParams extends ParamsDictionary {
  name: string
}

router.put('/api/tools/:name', async (req: Request<NameParams>, res) => {
  const applicationName = getAppName(req)
  await applications.updateToolForApplication(applicationName, req.params.name, req.body as Tool)
  res.sendStatus(204)
})

router.delete('/api/tools/:name', async (req: Request<NameParams>, res) => {
  const applicationName = getAppName(req)
  await applications.deleteToolForApplication(applicationName, req.params.name)
  res.sendStatus(204)
})

export default router
