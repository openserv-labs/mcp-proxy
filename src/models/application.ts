import { Schema, model, type Document } from 'mongoose'
import type { ParamConfig, Tool, Application } from '../types'

export interface IParamConfig extends Omit<ParamConfig, 'id'>, Document {
  id: string
}

export interface ITool extends Tool, Document {
  parameters: IParamConfig[]
}

export interface IApplication extends Application, Document {
  applicationName: string
  tools: ITool[]
}

export const ParamConfigSchema = new Schema<IParamConfig>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true, enum: ['string', 'number', 'boolean'] },
    description: { type: String, required: true }
  },
  { _id: false }
)

export const ToolSchema = new Schema<ITool>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    parameters: [ParamConfigSchema]
  },
  { _id: false }
)

const ApplicationSchema = new Schema<IApplication>({
  applicationName: { type: String, required: true, unique: true, index: true },
  backendUrl: { type: String },
  tools: [ToolSchema]
})

export const ApplicationModel = model<IApplication>('Application', ApplicationSchema)
