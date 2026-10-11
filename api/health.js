import { neon } from '@neondatabase/serverless';
import { createHealthHandler } from './_lib/healthHandler.js';

export default createHealthHandler({
  getConnectionString: () => process.env.DATABASE_URL,
  queryDatabase: async (connectionString) => {
    const sql = neon(connectionString);
    await sql`SELECT ${1}::integer AS ok`;
  },
});
