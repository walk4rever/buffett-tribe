import { PrismaClient } from '@prisma/client'

function getDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '10'
    url.searchParams.set('connection_limit', limit)
    const timeout = process.env.PRISMA_POOL_TIMEOUT ?? '30'
    url.searchParams.set('pool_timeout', timeout)
    return url.toString()
  } catch {
    return rawUrl
  }
}

const prismaClientSingleton = () => {
  const datasourceUrl = getDatasourceUrl()
  return new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined)
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
