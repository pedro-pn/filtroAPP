// A página de evidências usa fontes WinAnsi; não amplie para letras ou símbolos Unicode arbitrários.
const ALLOWED_NAME_CHARACTERS = /^[A-Za-zÀ-ÖØ-öø-ÿªº .,'’‘"“”()\-–—]+$/u;
const NAME_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/u;

export function normalizeSignatureSignerName(value) {
  return value.normalize('NFC').trim();
}

export function signatureSignerNameError(value) {
  const name = normalizeSignatureSignerName(value);
  if (name.length < 2 || !NAME_LETTER.test(name)) {
    return 'Informe o nome completo do assinante.';
  }
  if (name.length > 160) return 'O nome do assinante deve ter no máximo 160 caracteres.';
  if (!ALLOWED_NAME_CHARACTERS.test(name)) {
    return 'Use apenas letras, acentos, espaços e pontuação em português no nome, sem emojis ou números.';
  }
  return '';
}
