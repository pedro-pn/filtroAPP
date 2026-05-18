import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2] || process.env.ROMANEIO_EQUIPMENT_FILE || '';
if (inputPath) {
  const resolved = path.resolve(inputPath);
  await fs.access(resolved);
  process.env.ROMANEIO_EQUIPMENT_FILE = resolved;
}

const [{ syncRomaneioCatalog }, { default: prisma }] = await Promise.all([
  import('../src/lib/romaneio-catalog.js'),
  import('../src/lib/prisma.js')
]);

await syncRomaneioCatalog();

const [total, active, otherMaterials] = await Promise.all([
  prisma.romaneioCatalogItem.count(),
  prisma.romaneioCatalogItem.count({ where: { isActive: true } }),
  prisma.romaneioCatalogItem.count({ where: { isActive: true, categoryName: 'Outros materiais' } })
]);

const categories = await prisma.romaneioCatalogItem.groupBy({
  by: ['categoryName'],
  where: { isActive: true },
  _count: { _all: true },
  orderBy: { categoryName: 'asc' }
});

console.log(JSON.stringify({
  ok: true,
  sourceFile: process.env.ROMANEIO_EQUIPMENT_FILE || 'auto',
  total,
  active,
  otherMaterials,
  categories: categories.map(item => ({
    categoryName: item.categoryName,
    count: item._count._all
  }))
}, null, 2));

await prisma.$disconnect();
