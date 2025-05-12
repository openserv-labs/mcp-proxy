import express from 'express'
import type { Request } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'

import * as applications from '../services/application-manager'
import type { Tool } from '../types'

const router = express.Router()

// ───────────────────────── Helpers ─────────────────────────
const getAppName = (req: Request) => req.headers['x-application-name'] as string

// ───────────────────────── Views ───────────────────────────
router.get('/', (_req, res) => res.render('admin'))

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
  const { backendUrl } = req.body as { backendUrl?: string }

  if (await applications.applicationExists(applicationName)) {
    if (backendUrl) await applications.updateBackendUrl(applicationName, backendUrl.trim())
  } else {
    await applications.createApplication(applicationName, backendUrl?.trim())
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
