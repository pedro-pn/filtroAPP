const QR_ECC_LOW = 1;
const QR_CAPACITIES_LOW = [
  null,
  { dataCodewords: 19, eccCodewords: 7 },
  { dataCodewords: 34, eccCodewords: 10 },
  { dataCodewords: 55, eccCodewords: 15 },
  { dataCodewords: 80, eccCodewords: 20 },
  { dataCodewords: 108, eccCodewords: 26 }
];
const QR_ALIGNMENT_CENTERS = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30]
];

function qrSize(version) {
  return version * 4 + 17;
}

function qrMask(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2 + (row * col) % 3) === 0;
    case 6: return (((row * col) % 2 + (row * col) % 3) % 2) === 0;
    case 7: return (((row + col) % 2 + (row * col) % 3) % 2) === 0;
    default: return false;
  }
}

function gfMultiply(a, b) {
  let product = 0;
  for (let i = 7; i >= 0; i -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    if (((b >>> i) & 1) !== 0) product ^= a;
  }
  return product & 0xff;
}

function gfPow(base, exponent) {
  let value = 1;
  for (let i = 0; i < exponent; i += 1) value = gfMultiply(value, base);
  return value;
}

function reedSolomonGenerator(degree) {
  let generator = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = Array(generator.length + 1).fill(0);
    const root = gfPow(2, i);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= generator[j];
      next[j + 1] ^= gfMultiply(generator[j], root);
    }
    generator = next;
  }
  return generator;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const message = [...data, ...Array(degree).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const factor = message[i];
    if (!factor) continue;
    for (let j = 0; j < generator.length; j += 1) {
      message[i + j] ^= gfMultiply(generator[j], factor);
    }
  }
  return message.slice(message.length - degree);
}

function appendBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function qrDataCodewords(text, version) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  const capacity = QR_CAPACITIES_LOW[version].dataCodewords;
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  if (bits.length > capacity * 8) return null;
  appendBits(bits, 0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  for (let pad = 0; codewords.length < capacity; pad += 1) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return codewords;
}

function createQrGrid(size) {
  return {
    modules: Array.from({ length: size }, () => Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => Array(size).fill(false))
  };
}

function setQrModule(grid, row, col, value, reserve = true) {
  const size = grid.modules.length;
  if (row < 0 || col < 0 || row >= size || col >= size) return;
  grid.modules[row][col] = Boolean(value);
  if (reserve) grid.reserved[row][col] = true;
}

function drawFinderPattern(grid, row, col) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const distance = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      setQrModule(grid, row + y, col + x, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(grid, row, col) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      setQrModule(grid, row + y, col + x, distance !== 1);
    }
  }
}

function drawQrFunctionPatterns(grid, version) {
  const size = grid.modules.length;
  drawFinderPattern(grid, 0, 0);
  drawFinderPattern(grid, 0, size - 7);
  drawFinderPattern(grid, size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    setQrModule(grid, 6, i, i % 2 === 0);
    setQrModule(grid, i, 6, i % 2 === 0);
  }

  const centers = QR_ALIGNMENT_CENTERS[version] || [];
  for (const row of centers) {
    for (const col of centers) {
      const overlapsFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6);
      if (!overlapsFinder) drawAlignmentPattern(grid, row, col);
    }
  }

  setQrModule(grid, version * 4 + 9, 8, true);
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setQrModule(grid, 8, i, false);
      setQrModule(grid, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setQrModule(grid, 8, size - 1 - i, false);
    setQrModule(grid, size - 1 - i, 8, false);
  }
}

function placeQrData(grid, codewords) {
  const size = grid.modules.length;
  const bits = [];
  for (const codeword of codewords) appendBits(bits, codeword, 8);
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (grid.reserved[row][col]) continue;
        grid.modules[row][col] = bits[bitIndex] === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function applyQrMask(modules, reserved, mask) {
  const size = modules.length;
  const masked = modules.map(row => row.slice());
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!reserved[row][col] && qrMask(mask, row, col)) masked[row][col] = !masked[row][col];
    }
  }
  return masked;
}

function qrPenalty(modules) {
  const size = modules.length;
  let penalty = 0;
  for (let row = 0; row < size; row += 1) {
    let runColor = modules[row][0];
    let runLength = 1;
    for (let col = 1; col < size; col += 1) {
      if (modules[row][col] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += runLength - 2;
        runColor = modules[row][col];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += runLength - 2;
  }
  for (let col = 0; col < size; col += 1) {
    let runColor = modules[0][col];
    let runLength = 1;
    for (let row = 1; row < size; row += 1) {
      if (modules[row][col] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += runLength - 2;
        runColor = modules[row][col];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += runLength - 2;
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const color = modules[row][col];
      if (modules[row][col + 1] === color && modules[row + 1][col] === color && modules[row + 1][col + 1] === color) {
        penalty += 3;
      }
    }
  }
  const dark = modules.flat().filter(Boolean).length;
  penalty += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return penalty;
}

function qrFormatBits(mask) {
  const data = (QR_ECC_LOW << 3) | mask;
  let bits = data << 10;
  const divisor = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if (((bits >>> i) & 1) !== 0) bits ^= divisor << (i - 10);
  }
  return ((data << 10) | bits) ^ 0x5412;
}

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function drawQrFormatBits(grid, modules, mask) {
  const size = modules.length;
  const bits = qrFormatBits(mask);
  const set = (row, col, value) => {
    modules[row][col] = value;
    grid.reserved[row][col] = true;
  };

  for (let i = 0; i <= 5; i += 1) set(i, 8, getBit(bits, i));
  set(7, 8, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(8, 7, getBit(bits, 8));
  for (let i = 9; i < 15; i += 1) set(8, 14 - i, getBit(bits, i));

  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, getBit(bits, i));
  for (let i = 8; i < 15; i += 1) set(size - 15 + i, 8, getBit(bits, i));
  set(size - 8, 8, true);
}

export function createValidationQrCodeMatrix(text) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  const version = QR_CAPACITIES_LOW.findIndex((entry, index) =>
    index > 0 && bytes.length <= entry.dataCodewords - 2
  );
  if (version < 1) return null;

  const data = qrDataCodewords(text, version);
  if (!data) return null;
  const ecc = reedSolomonRemainder(data, QR_CAPACITIES_LOW[version].eccCodewords);
  const grid = createQrGrid(qrSize(version));
  drawQrFunctionPatterns(grid, version);
  placeQrData(grid, [...data, ...ecc]);

  let bestMask = 0;
  let bestModules = applyQrMask(grid.modules, grid.reserved, 0);
  let bestPenalty = qrPenalty(bestModules);
  for (let mask = 1; mask < 8; mask += 1) {
    const masked = applyQrMask(grid.modules, grid.reserved, mask);
    const penalty = qrPenalty(masked);
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestModules = masked;
      bestPenalty = penalty;
    }
  }
  drawQrFormatBits(grid, bestModules, bestMask);
  return bestModules;
}
