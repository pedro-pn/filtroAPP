export function normalizeCnpj(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 14);
}

export function formatCnpj(value) {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return digits || '';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
