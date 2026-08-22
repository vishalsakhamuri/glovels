'use strict';
/**
 * Excel, without a library.
 *
 * An .xlsx is a ZIP of XML files. Node ships zlib, so reading and writing one
 * is a few hundred lines rather than a dependency — and a dependency here would
 * be a large one, in the part of the system that ingests a file somebody
 * emailed to the office.
 *
 * What this supports, deliberately:
 *   - Writing a single sheet with a header row. Inline strings, no shared
 *     string table: bigger on disk, and impossible to get subtly wrong.
 *   - Reading the FIRST sheet of a workbook, values only. Formulas come back as
 *     their last cached result, which is what Excel shows and what a person
 *     filling in a spreadsheet means.
 *   - CSV both ways, because "save as CSV" is what half of Excel users do.
 *
 * What it does not support, and does not pretend to: styling, multiple sheets,
 * merged cells, dates as serial numbers (they come back as text — the importer
 * validates the format anyway).
 */

const zlib = require('zlib');

/* ------------------------------------------------------------------- CRC32 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* --------------------------------------------------------------- ZIP write */

/* Entries are STORED, not deflated. An .xlsx of a few hundred rows is small
   either way, and stored entries remove a whole class of "Excel says the file
   is corrupt" bugs. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach(({ name, data }) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method: stored
    local.writeUInt16LE(0, 10);           // time
    local.writeUInt16LE(0x21, 12);        // date (1 Jan 1996 — fixed, so builds are reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  });

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ---------------------------------------------------------------- ZIP read */

function unzip(buf) {
  /* Find the end-of-central-directory record. It is at the end, but a ZIP may
     carry a comment after it, so scan backwards. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('That does not look like a .xlsx file.');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    /* The local header repeats the name and extra fields, and its extra length
       often differs from the central one — read it rather than assuming. */
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);

    out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ------------------------------------------------------------------ XML io */

const xmlEscape = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  /* Control characters are illegal in XML 1.0 and make Excel refuse the file
     outright. A stray tab or newline pasted into a cell is enough. */
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

const xmlUnescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  /* fromCodePoint, not fromCharCode: anything above U+FFFF — every emoji, and
     therefore every flag someone pastes into a destination — is truncated to
     nonsense by fromCharCode. A 🇦🇺 arrived as an empty string. */
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** A1, B1 … AA1. Excel's column names, which are base-26 with no zero. */
function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const colIndex = ref => {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/* --------------------------------------------------------------- write xlsx */

function writeXlsx(headers, rows, sheetName = 'Catalogue') {
  const cell = (r, c, value) => {
    const ref = colName(c) + (r + 1);
    if (value == null || value === '') return '';
    /* Numbers as numbers, so Excel can total a fee column. Anything that only
       looks numeric — an id like "0012" — stays text so it keeps its zeros. */
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  };

  const head = '<row r="1">' + headers.map((h, c) => cell(0, c, String(h))).join('') + '</row>';
  const body = rows.map((row, r) =>
    '<row r="' + (r + 2) + '">' + row.map((v, c) => cell(r + 1, c, v)).join('') + '</row>').join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${head}${body}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const B = s => Buffer.from(s, 'utf8');
  return zip([
    { name: '[Content_Types].xml', data: B(contentTypes) },
    { name: '_rels/.rels', data: B(rootRels) },
    { name: 'xl/workbook.xml', data: B(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: B(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: B(sheet) },
  ]);
}

/* ---------------------------------------------------------------- read xlsx */

function readXlsx(buf) {
  const files = unzip(buf);
  const sheetKey = Object.keys(files).find(k => /^xl\/worksheets\/sheet1\.xml$/i.test(k))
    || Object.keys(files).find(k => /^xl\/worksheets\/.*\.xml$/i.test(k));
  if (!sheetKey) throw new Error('No worksheet found in that file.');

  /* Shared strings: most spreadsheets Excel saves put every text value here and
     reference it by index from the cell. */
  let shared = [];
  const ssKey = Object.keys(files).find(k => /sharedStrings\.xml$/i.test(k));
  if (ssKey) {
    const xml = files[ssKey].toString('utf8');
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
      /* An <si> can be split into several <t> runs by formatting. Joining them
         is what the user sees in the cell. */
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlUnescape(t[1])).join(''));
  }

  const xml = files[sheetKey].toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1] || '';
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || 'n';
      const idx = ref ? colIndex(ref) : cells.length;

      let value = '';
      if (type === 's') {
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        value = shared[Number(v)] != null ? shared[Number(v)] : '';
      } else if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map(t => xmlUnescape(t[1])).join('');
      } else {
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        value = v == null ? '' : xmlUnescape(v);
      }
      while (cells.length < idx) cells.push('');   // blank cells are simply absent
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/* ---------------------------------------------------------------------- CSV */

function writeCsv(headers, rows) {
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  /* A BOM, so Excel on Windows opens a UTF-8 CSV without mangling the rupee
     sign and the flags. Without it they arrive as mojibake. */
  return '﻿' + [headers, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}

function readCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* handled by the \n that follows */ }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Rows of cells → objects keyed by the header row, trimmed and lower-cased. */
function toObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r.some(c => String(c || '').trim() !== ''))     // skip blank lines
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = String(r[i] == null ? '' : r[i]).trim(); });
      return o;
    });
}

module.exports = { writeXlsx, readXlsx, writeCsv, readCsv, toObjects, zip, unzip };
