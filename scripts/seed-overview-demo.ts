import { pool } from "@workspace/db";
import { seedOverviewDemo } from "./src/seed-overview-demo";
try { console.info(JSON.stringify(await seedOverviewDemo())); }
finally { await pool.end(); }
