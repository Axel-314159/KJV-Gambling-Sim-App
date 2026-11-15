import pg from 'pg';
import { env } from '../config/env.js';

// Parse PostgreSQL BIGINT (OID 20) as JS numbers for clean JSON serialization
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}