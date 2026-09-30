import { PrismaClient } from '@prisma/client'

function getDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url) return undefined
  if (url.includes('connection_limit=')) return url
  const delimiter = url.includes('?') ? '&' : '?'
  const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '3'
  return `${url}${delimiter}connection_limit=${limit}`
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
