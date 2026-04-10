import 'dotenv/config';
import path from 'node:path';

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads')
};

export default env;
