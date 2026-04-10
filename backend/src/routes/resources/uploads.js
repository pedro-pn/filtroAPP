import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const schema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
  label: z.string().min(1)
});

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const match = data.dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Formato de imagem invalido.' });
  }

  const ext = path.extname(data.fileName) || '';
  const safeName = `${Date.now()}-${randomUUID()}${ext}`;
  const targetPath = path.join(env.uploadDir, safeName);

  await fs.writeFile(targetPath, Buffer.from(match[2], 'base64'));

  res.status(201).json({
    label: data.label,
    fileName: data.fileName,
    mimeType: data.mimeType,
    url: `/uploads/${safeName}`
  });
}));

export default router;
