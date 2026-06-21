import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | undefined

export class ApiError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export function getPool(): pg.Pool {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new ApiError(503, 'DATABASE_URL is not configured')
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString)
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })

  return pool
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params)
}
