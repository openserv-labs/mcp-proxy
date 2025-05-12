import mongoose from 'mongoose'
import { logger } from '../utils/logger'

export async function initializeDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    logger.error('FATAL ERROR: MONGODB_URI environment variable is not set.')
    process.exit(1)
  }

  try {
    await mongoose.connect(mongoUri)
    logger.info('MongoDB connected successfully.')
  } catch (error) {
    logger.error('MongoDB connection error:', error)
    process.exit(1)
  }

  mongoose.connection.on('error', err => {
    logger.error('MongoDB runtime error:', err)
  })

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected.')
  })
}
