/** Self-contained QR Code Model 2 encoder for the short public verification URL (version 5-L, byte mode). */
export function renderAssuranceQrSvg(value: string): Buffer {
  const bytes = [...Buffer.from(value, "utf8")];
  if (bytes.length > 106) throw new Error("assurance_verification_url_too_long");
  const bits: number[] = [];
  const append = (number: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((number >>> bit) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  for (let index = 0; index < Math.min(4, 108 * 8 - bits.length); index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) data.push(Number.parseInt(bits.slice(index, index + 8).join(""), 2));
  for (let pad = 0; data.length < 108; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);

  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let x = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = x;
    log[x] = index;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255]!;
  const multiply = (left: number, right: number) => left && right ? exp[log[left]! + log[right]!]! : 0;
  let generator = [1];
  for (let degree = 0; degree < 26; degree += 1) {
    const next = new Array<number>(generator.length + 1).fill(0);
    for (let index = 0; index < generator.length; index += 1) {
      next[index] ^= generator[index]!;
      next[index + 1] ^= multiply(generator[index]!, exp[degree]!);
    }
    generator = next;
  }
  const remainder = [...data, ...new Array<number>(26).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index]!;
    for (let coefficient = 0; coefficient < generator.length; coefficient += 1) {
      remainder[index + coefficient] ^= multiply(generator[coefficient]!, factor);
    }
  }
  const codewords = [...data, ...remainder.slice(data.length)];
  const payload: number[] = [];
  for (const codeword of codewords) appendTo(codeword, 8, payload);

  const size = 37;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (column: number, row: number, dark: boolean) => {
    if (column < 0 || row < 0 || column >= size || row >= size) return;
    modules[row]![column] = dark;
    reserved[row]![column] = true;
  };
  const finder = (column: number, row: number) => {
    for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) {
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(column + dx, row + dy, dark);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let index = 8; index < size - 8; index += 1) {
    set(index, 6, index % 2 === 0);
    set(6, index, index % 2 === 0);
  }
  for (const row of [6, 30]) for (const column of [6, 30]) {
    if (reserved[row]![column]) continue;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(column + dx, row + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) { set(8, index, false); set(index, 8, false); }
  }
  for (let index = 0; index < 8; index += 1) { set(size - 1 - index, 8, false); set(8, size - 1 - index, false); }
  set(8, size - 8, true);

  let cursor = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (reserved[row]![column]) continue;
        const raw = payload[cursor++] ?? 0;
        modules[row]![column] = Boolean(raw ^ (((row + column) & 1) === 0 ? 1 : 0));
      }
    }
  }
  const format = formatBits(0);
  for (let index = 0; index <= 5; index += 1) set(8, index, bit(format, index));
  set(8, 7, bit(format, 6)); set(8, 8, bit(format, 7)); set(7, 8, bit(format, 8));
  for (let index = 9; index < 15; index += 1) set(14 - index, 8, bit(format, index));
  for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, bit(format, index));
  for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, bit(format, index));
  set(8, size - 8, true);

  const path: string[] = [];
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) if (modules[row]![column]) path.push(`M${column + 4},${row + 4}h1v1h-1z`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path.join("")}" fill="black"/></svg>`, "utf8");
}

function appendTo(value: number, length: number, target: number[]) {
  for (let index = length - 1; index >= 0; index -= 1) target.push((value >>> index) & 1);
}

function formatBits(mask: number) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function bit(value: number, index: number) {
  return ((value >>> index) & 1) !== 0;
}
