export const inhibitionVessels = ['51632', '51633', '51634'].map((code, index) => ({
  code,
  order: index
}));

export async function seedInhibitionOptions(prisma) {
  for (const vessel of inhibitionVessels) {
    await prisma.inhibitionVessel.upsert({
      where: { code: vessel.code },
      update: { ...vessel, isActive: true },
      create: vessel
    });
  }
}
