import 'dotenv/config';
import path from 'node:path';

const reportsDir = process.env.REPORTS_DIR || process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'Relatórios');

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  assetsDir: process.env.ASSETS_DIR || path.resolve(process.cwd(), 'assets'),
  reportsDir,
  uploadDir: reportsDir
};

export default env;
