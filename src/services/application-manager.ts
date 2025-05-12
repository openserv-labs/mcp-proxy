import { ApplicationModel, type IApplication, type ITool } from '../models/application'
import type { Tool } from '../types'

/* ───────────────────── Tools ───────────────────── */
export async function getToolsForApplication(applicationName: string): Promise<Tool[]> {
  const application = await ApplicationModel.findOne(
    { applicationName },
    'tools'
  ).lean<IApplication | null>()
  return (application?.tools as unknown as Tool[]) ?? []
}

export async function addToolForApplication(applicationName: string, tool: Tool) {
  await ApplicationModel.updateOne(
    { applicationName, 'tools.name': { $ne: tool.name } },
    { $push: { tools: tool as ITool } }
  )
}

export async function updateToolForApplication(
  applicationName: string,
  toolName: string,
  updated: Tool
) {
  if (toolName !== updated.name) throw new Error('Tool name is immutable')
  await ApplicationModel.updateOne(
    { applicationName, 'tools.name': toolName },
    { $set: { 'tools.$': updated } }
  )
}

export async function deleteToolForApplication(applicationName: string, toolName: string) {
  await ApplicationModel.updateOne({ applicationName }, { $pull: { tools: { name: toolName } } })
}

/* ───────────────────── Applications ───────────────────── */
export const getApplicationByName = (applicationName: string) =>
  ApplicationModel.findOne({ applicationName }).lean<IApplication | null>()

export const applicationExists = (applicationName: string) =>
  ApplicationModel.exists({ applicationName }).then(Boolean)

export async function createApplication(applicationName: string, backendUrl?: string) {
  const application = new ApplicationModel({ applicationName, backendUrl, tools: [] })
  return application.save()
}

export async function createApplicationIfNotExists(applicationName: string) {
  await ApplicationModel.updateOne(
    { applicationName },
    { $setOnInsert: { applicationName, tools: [] } },
    { upsert: true }
  )
}

/* ───────────────────── Backend URL ───────────────────── */
export async function getBackendUrl(applicationName: string): Promise<string | undefined> {
  const application = await ApplicationModel.findOne({ applicationName }, 'backendUrl').lean<{
    backendUrl?: string
  } | null>()
  return application?.backendUrl
}

export const updateBackendUrl = (applicationName: string, backendUrl: string) =>
  ApplicationModel.updateOne({ applicationName }, { $set: { backendUrl } })
