import ipaddr from 'ipaddr.js';

function normalizedAddress(value) {
  let address = ipaddr.parse(String(value || '').trim());
  if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) address = address.toIPv4Address();
  return address;
}

export function normalizeIp(value) {
  try {
    return normalizedAddress(value).toString();
  } catch {
    throw new Error('Endereço IP inválido.');
  }
}

export function normalizeCidrs(values = []) {
  if (!Array.isArray(values)) throw new Error('A allowlist de CIDR deve ser uma lista.');
  const normalized = values.map(value => {
    const raw = String(value || '').trim();
    try {
      const [address, prefix] = ipaddr.parseCIDR(raw);
      const family = address.kind();
      const network = family === 'ipv4'
        ? ipaddr.IPv4.networkAddressFromCIDR(raw)
        : ipaddr.IPv6.networkAddressFromCIDR(raw);
      return `${network.toString()}/${prefix}`;
    } catch {
      throw new Error(`CIDR inválido: ${raw || '(vazio)'}.`);
    }
  });
  return [...new Set(normalized)].sort();
}

export function isIpAllowed(value, cidrs = []) {
  if (!cidrs?.length) return true;
  let address;
  try {
    address = normalizedAddress(value);
  } catch {
    return false;
  }
  return cidrs.some(cidr => {
    try {
      let [network, prefix] = ipaddr.parseCIDR(cidr);
      if (network.kind() === 'ipv6' && network.isIPv4MappedAddress()) network = network.toIPv4Address();
      return address.kind() === network.kind() && address.match(network, prefix);
    } catch {
      return false;
    }
  });
}

export function resolveEffectiveClientIp(req) {
  const resolved = req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  try {
    return normalizeIp(resolved);
  } catch {
    return '';
  }
}
