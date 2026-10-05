/** Move uma foto sem alterar seus dados ou a ordem relativa das demais. */
export function moveUpload<T>(files: readonly T[], from: number, to: number): T[] {
  const next = [...files];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= files.length || to >= files.length || from === to) return next;
  const [file] = next.splice(from, 1);
  next.splice(to, 0, file);
  return next;
}
