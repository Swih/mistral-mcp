/**
 * A minimal PDF writer — enough to build an ingestion test corpus, nothing more.
 *
 * Replaces the reportlab script this directory used to carry. That script could
 * not be run from the repo's own toolchain (it needed Python plus a third-party
 * package), so the fixtures were effectively frozen binaries nobody could
 * regenerate or review. This is Node with no dependencies: `npm run
 * fixtures:generate` rebuilds the corpus from source anyone can read.
 *
 * Deliberately uncompressed content streams. A reviewer can `grep` a generated
 * PDF and see the text that is supposed to be in it, and the corpus test can
 * verify extraction without a PDF library.
 *
 * Supports what a heterogeneous corpus actually needs: multiple pages, the two
 * standard Helvetica faces, WinAnsi text (French accents and the euro sign),
 * ruled lines for tables, and per-page /Rotate for landscape scans.
 */

/** Unicode -> WinAnsiEncoding for the characters this corpus uses. */
const WIN_ANSI = new Map([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a],
  ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["'", 0x91], ["'", 0x92],
  ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c], ["ž", 0x9e],
  ["Ÿ", 0x9f], ["’", 0x92],
]);

/** Encode a JS string as a PDF literal string in WinAnsiEncoding. */
function pdfString(text) {
  const bytes = [];
  for (const ch of text) {
    const code = WIN_ANSI.get(ch) ?? ch.codePointAt(0);
    // Anything outside WinAnsi's single-byte range becomes '?' rather than
    // silently emitting a byte that renders as something else.
    const byte = code !== undefined && code <= 0xff ? code : 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // ( ) \
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

const A4 = { width: 595.28, height: 841.89 };

/**
 * One page under construction. Coordinates are PDF points from the bottom-left,
 * but `text()` takes a top-down `y` because every caller thinks in pages.
 */
class Page {
  constructor(opts = {}) {
    this.width = opts.width ?? A4.width;
    this.height = opts.height ?? A4.height;
    /** 0 | 90 | 180 | 270 — how a viewer must rotate the page to display it. */
    this.rotate = opts.rotate ?? 0;
    this.ops = [];
  }

  /** Draw one line of text. `y` is measured down from the top of the page. */
  text(x, y, content, { size = 11, bold = false } = {}) {
    const font = bold ? "/F2" : "/F1";
    const chunks = [
      Buffer.from(`BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(this.height - y).toFixed(2)} Tm (`),
      pdfString(content),
      Buffer.from(") Tj ET\n"),
    ];
    this.ops.push(Buffer.concat(chunks));
    return this;
  }

  /** Several lines from one starting point, top-down. */
  lines(x, y, rows, opts = {}) {
    const leading = opts.leading ?? (opts.size ?? 11) + 4;
    rows.forEach((row, i) => this.text(x, y + i * leading, row, opts));
    return this;
  }

  /** A straight rule — what makes a table look like a table to an OCR model. */
  rule(x1, y1, x2, y2, width = 0.75) {
    this.ops.push(
      Buffer.from(
        `${width} w ${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m ` +
          `${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l S\n`
      )
    );
    return this;
  }

  /** A row of cells at fixed column offsets, optionally underlined. */
  row(y, columns, { size = 10, bold = false, rule = false, from = 50, to = 545 } = {}) {
    for (const [x, value] of columns) this.text(x, y, value, { size, bold });
    if (rule) this.rule(from, y + 4, to, y + 4);
    return this;
  }

  content() {
    return Buffer.concat(this.ops);
  }
}

/** A document being assembled. */
export class PdfDocument {
  constructor() {
    this.pages = [];
  }

  addPage(opts) {
    const page = new Page(opts);
    this.pages.push(page);
    return page;
  }

  /** Serialize to a complete PDF file. */
  render() {
    const objects = [];
    /** Reserve an object number; body is filled in later. */
    const reserve = () => objects.push(null) ;

    // 1 catalog, 2 pages tree, 3 + 4 fonts, then two objects per page.
    const catalogId = reserve();
    const pagesId = reserve();
    const fontRegularId = reserve();
    const fontBoldId = reserve();

    const pageIds = [];
    const contentIds = [];
    for (let i = 0; i < this.pages.length; i++) {
      pageIds.push(reserve());
      contentIds.push(reserve());
    }

    objects[catalogId - 1] = Buffer.from(
      `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    );
    objects[pagesId - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] ` +
        `/Count ${this.pages.length} >>`
    );
    objects[fontRegularId - 1] = Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    );
    objects[fontBoldId - 1] = Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    );

    this.pages.forEach((page, i) => {
      const stream = page.content();
      objects[pageIds[i] - 1] = Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] ` +
          (page.rotate ? `/Rotate ${page.rotate} ` : "") +
          `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> ` +
          `/Contents ${contentIds[i]} 0 R >>`
      );
      objects[contentIds[i] - 1] = Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from("\nendstream"),
      ]);
    });

    // --- assemble, recording byte offsets for the xref table ---
    const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let offset = chunks[0].length;
    const offsets = [];

    objects.forEach((body, index) => {
      offsets.push(offset);
      const obj = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`),
        body,
        Buffer.from("\nendobj\n"),
      ]);
      chunks.push(obj);
      offset += obj.length;
    });

    const xrefStart = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref +=
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(Buffer.from(xref));

    return Buffer.concat(chunks);
  }
}

export { A4 };
