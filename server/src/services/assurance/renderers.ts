import { canonicalizeAssuranceJson } from "./canonicalizer.js";

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function renderAssuranceXml(manifest: Record<string, unknown>, digest: string): Buffer {
  const canonical = canonicalizeAssuranceJson(manifest);
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<foundationAssurance schemaVersion="${xmlEscape(String(manifest.schemaVersion ?? ""))}">\n  <manifestSha256>${digest}</manifestSha256>\n  <canonicalManifest encoding="base64">${Buffer.from(canonical, "utf8").toString("base64")}</canonicalManifest>\n</foundationAssurance>\n`,
    "utf8",
  );
}

function pdfEscape(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\xFF]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

type PdfColor = readonly [number, number, number];

const PDF_COLORS = {
  ink: [0.075, 0.09, 0.105] as PdfColor,
  muted: [0.38, 0.41, 0.44] as PdfColor,
  line: [0.86, 0.875, 0.89] as PdfColor,
  surface: [0.965, 0.97, 0.975] as PdfColor,
  paper: [1, 1, 1] as PdfColor,
  brand: [0.08, 0.105, 0.12] as PdfColor,
  success: [0.075, 0.45, 0.28] as PdfColor,
  successSoft: [0.91, 0.975, 0.94] as PdfColor,
  warning: [0.62, 0.38, 0.035] as PdfColor,
  warningSoft: [0.99, 0.96, 0.87] as PdfColor,
};

function pdfNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function colorCommand(color: PdfColor, stroke = false): string {
  return `${color.map(pdfNumber).join(" ")} ${stroke ? "RG" : "rg"}`;
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 3))}...`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatIssuedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

export function renderAssurancePdf(input: {
  title: string;
  version?: number;
  scopeLabel?: string;
  publicId: string;
  manifestSha256: string;
  sealedAt: string;
  taskCount: number;
  totals: { costCents: number; inputTokens: number; outputTokens: number };
  tasks?: Array<{ title: string; state: string; runs: number; deliverables: number }>;
  verificationUrl: string;
  signatureLabel: string;
  timestampLabel: string;
}): Buffer {
  const stream: string[] = [];
  const text = (value: string, x: number, y: number, size = 10, font = "F1", color: PdfColor = PDF_COLORS.ink) => {
    stream.push(`BT /${font} ${pdfNumber(size)} Tf ${colorCommand(color)} 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm (${pdfEscape(value)}) Tj ET`);
  };
  const rect = (x: number, y: number, width: number, height: number, fill: PdfColor, stroke?: PdfColor) => {
    stream.push(`q ${colorCommand(fill)}${stroke ? ` ${colorCommand(stroke, true)} 0.7 w` : ""} ${x} ${y} ${width} ${height} re ${stroke ? "B" : "f"} Q`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color = PDF_COLORS.line) => {
    stream.push(`q ${colorCommand(color, true)} 0.7 w ${x1} ${y1} m ${x2} ${y2} l S Q`);
  };
  const foundationGlyph = (x: number, top: number, scale: number, color: PdfColor) => {
    // Canonical Foundation Pillar geometry from ui/public/foundation/foundation-glyph-white.svg.
    const point = (sourceX: number, sourceY: number) =>
      `${pdfNumber(x + (sourceX - 50) * scale)} ${pdfNumber(top - (sourceY - 18) * scale)}`;
    const polygons = [
      [[50, 73], [68, 59], [68, 142.595], [50, 128]],
      [[77, 33], [97, 18], [97, 149.892], [87, 158], [77, 149.892]],
      [[106, 38], [124, 53], [124, 128], [106, 142.595]],
    ];
    for (const polygon of polygons) {
      const [first, ...rest] = polygon;
      if (!first) continue;
      stream.push(`q ${colorCommand(color)} ${point(first[0]!, first[1]!)} m ${rest.map(([px, py]) => `${point(px!, py!)} l`).join(" ")} h f Q`);
    }
  };

  // Executive header.
  rect(0, 642, 612, 150, PDF_COLORS.brand);
  foundationGlyph(56, 754, 0.227, PDF_COLORS.paper);
  text("FOUNDATION", 84, 746, 9, "F2", [0.76, 0.79, 0.81]);
  text("ASSURANCE", 84, 731, 9, "F2", PDF_COLORS.paper);
  rect(455, 724, 101, 24, PDF_COLORS.success);
  text(`SEALED  /  V${input.version ?? 1}`, 473, 732, 9, "F2", PDF_COLORS.paper);
  text(fitText(input.title, 48), 56, 683, 25, "F2", PDF_COLORS.paper);
  text("Evidence dossier and integrity record", 56, 661, 10, "F1", [0.76, 0.79, 0.81]);

  // Summary cards.
  text("EXECUTIVE SUMMARY", 56, 615, 8, "F2", PDF_COLORS.muted);
  const summaryCards = [
    { x: 56, label: "VALIDATED TASKS", value: String(input.taskCount) },
    { x: 226, label: "TOTAL TOKENS", value: formatCount(input.totals.inputTokens + input.totals.outputTokens) },
    { x: 396, label: "RECORDED COST", value: `${(input.totals.costCents / 100).toFixed(2)} USD` },
  ];
  for (const card of summaryCards) {
    rect(card.x, 548, 160, 54, PDF_COLORS.surface, PDF_COLORS.line);
    text(card.label, card.x + 14, 582, 7.5, "F2", PDF_COLORS.muted);
    text(card.value, card.x + 14, 559, 16, "F2");
  }

  // Included evidence table.
  text("VALIDATED EVIDENCE", 56, 519, 8, "F2", PDF_COLORS.muted);
  text("Task", 68, 496, 8, "F2", PDF_COLORS.muted);
  text("Runs", 448, 496, 8, "F2", PDF_COLORS.muted);
  text("Status", 500, 496, 8, "F2", PDF_COLORS.muted);
  line(56, 486, 556, 486);
  const tasks = input.tasks?.slice(0, 5) ?? [];
  if (tasks.length === 0) {
    text(`${input.taskCount} task validation${input.taskCount === 1 ? "" : "s"} retained in the canonical manifest.`, 68, 462, 10);
  } else {
    tasks.forEach((task, index) => {
      const y = 462 - index * 27;
      text(fitText(task.title, 54), 68, y, 9.5, "F1");
      text(String(task.runs), 452, y, 9.5, "F3");
      text(task.state.toUpperCase(), 500, y, 8, "F2", task.state === "valid" ? PDF_COLORS.success : PDF_COLORS.warning);
      line(68, y - 11, 556, y - 11, PDF_COLORS.surface);
    });
  }

  // Integrity receipt.
  rect(56, 242, 500, 108, PDF_COLORS.brand);
  text("CRYPTOGRAPHIC INTEGRITY", 72, 329, 8, "F2", [0.72, 0.76, 0.78]);
  text("SHA-256 MANIFEST DIGEST", 72, 306, 7, "F2", [0.62, 0.67, 0.7]);
  text(input.manifestSha256.slice(0, 32), 72, 288, 10, "F3", PDF_COLORS.paper);
  text(input.manifestSha256.slice(32), 72, 273, 10, "F3", PDF_COLORS.paper);
  text(`Public ID  ${input.publicId}`, 72, 254, 7.5, "F3", [0.72, 0.76, 0.78]);

  // Trust controls and verification route.
  text("TRUST CONTROLS", 56, 216, 8, "F2", PDF_COLORS.muted);
  const signatureConfigured = !input.signatureLabel.toLowerCase().includes("not configured");
  const timestampConfigured = !input.timestampLabel.toLowerCase().includes("not_configured");
  const trustCards = [
    { x: 56, label: "DIGITAL SIGNATURE", value: input.signatureLabel, configured: signatureConfigured },
    { x: 311, label: "TIMESTAMP", value: input.timestampLabel.replaceAll("_", " "), configured: timestampConfigured },
  ];
  for (const card of trustCards) {
    rect(card.x, 165, 245, 39, card.configured ? PDF_COLORS.successSoft : PDF_COLORS.warningSoft);
    text(card.label, card.x + 12, 189, 7, "F2", card.configured ? PDF_COLORS.success : PDF_COLORS.warning);
    text(fitText(card.value.toUpperCase(), 34), card.x + 12, 175, 8.5, "F2");
  }
  text("VERIFY THIS DOSSIER", 56, 140, 8, "F2", PDF_COLORS.muted);
  text(fitText(input.verificationUrl, 88), 56, 122, 8.5, "F3", PDF_COLORS.ink);
  text(`Issued ${formatIssuedAt(input.sealedAt)}  |  Scope ${input.scopeLabel ?? "dossier"}`, 56, 104, 8, "F1", PDF_COLORS.muted);

  line(56, 83, 556, 83);
  text("This dossier records technical evidence retained by Foundation. It is not a tax audit, legal certification,", 56, 66, 7.4, "F1", PDF_COLORS.muted);
  text("or statement of deductibility. Verify the manifest digest before relying on exported artifacts.", 56, 54, 7.4, "F1", PDF_COLORS.muted);
  text("FOUNDATION ASSURANCE", 56, 30, 7, "F2", PDF_COLORS.muted);
  text("PAGE 1 / 1", 505, 30, 7, "F2", PDF_COLORS.muted);

  const content = stream.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** Creates a standards-compliant, uncompressed ZIP without an external dependency. */
export function renderAssuranceZip(files: Array<{ name: string; body: Buffer }>, now = new Date()): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const stamp = dosTime(now);
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.body);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.body.length, 18);
    local.writeUInt32LE(file.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, file.body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.body.length, 20);
    central.writeUInt32LE(file.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + file.body.length;
  }
  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
