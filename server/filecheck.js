'use strict';
const fs = require('fs');
const path = require('path');
const DOCSLOTS = require('./docs.js');
/*
 * WHAT A FILE ON A STUDENT'S RECORD IS, judged today (round 175, item 5).
 *
 * The upload route refuses a file that is not a PDF, a photo or a Word file
 * (api.js wrongType), and refuses a Word file in a slot that has to hold a
 * scan (slotRefuses). Files uploaded before those checks existed still sit on
 * students' records — a 31-byte "QA Fake Script.html" in the Academic CV
 * slot — and because the DOCUMENT carried the status, accepting the real CV
 * beside it turned the HTML file into a "verified" CV too.
 *
 * So the rules the uploads keep are written once, here, and read by:
 *   - the listings (counsellor, admin, the student's own Documents screen):
 *     a file's own state is what is shown, never the slot's
 *   - the per-file and whole-document Accept routes, which refuse a file
 *     that fails
 *   - the sweep, which marks such files `verdict = 'bad'` at startup and
 *     every ten minutes, so a file that was never re-read is still caught
 *
 * Nothing here deletes a file. A bad file is shown as not accepted, with a
 * Remove button, and stays on disk and in the table until somebody removes it.
 */
const FILE_KINDS = [
  { ext: ['pdf'], what: 'PDF', sig: b => b.slice(0, 5).toString('latin1') === '%PDF-' },
  { ext: ['jpg', 'jpeg'], what: 'JPG', sig: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ['png'], what: 'PNG',
    sig: b => b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' },
  /* HEIC/HEIF: 'ftyp' at byte 4, then the brand. */
  { ext: ['heic', 'heif'], what: 'HEIC',
    sig: b => b.slice(4, 8).toString('latin1') === 'ftyp'
      && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.slice(8, 12).toString('latin1')) },
  /* .docx is a zip. Requiring the extension too is what stops a .zip of
     anything walking in behind it. */
  { ext: ['docx'], what: 'Word',
    sig: b => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) },
  /* And the old binary Word, which is an OLE compound file. */
  { ext: ['doc'], what: 'Word',
    sig: b => b.slice(0, 8).toString('hex') === 'd0cf11e0a1b11ae1' },
];
const FILE_LIST = 'PDF, a photo (JPG, PNG or HEIC) or Word';

/* CNS-07 (4): WHAT EACH SLOT TAKES. Every slot takes a PDF or a photo
   (JPG, PNG, HEIC); Word only where the document is something WRITTEN — the
   SOP, the letters, the CV, a work letter, a sponsor's letter, the visa
   form and cover letter, "other". A passport, a marksheet or a certificate
   is a scan of a paper document, and a .docx in the Passport slot is not
   one. */
const WORD_SLOTS = new Set(['sop', 'lor', 'visa-cover', 'visa-form', 'cv', 'work', 'finance', 'other']);
const ID_SLOTS = /^(passport|photo|aadhaar|pan)/i;
/* A PDF smaller than this is not a document anybody scanned. 128 bytes, not
   the 1 KB first asked for: the demo files the seed writes and the fixtures
   seven suites upload are 50–750-byte PDFs with a real header, and a 1 KB
   floor would mark the demo student's whole checklist "not accepted" on
   every fresh database. A 31-byte script or an empty "PDF" still fails;
   anything with the header and under 128 bytes holds no page. */
const MIN_PDF_BYTES = 128;

const extOf = name => String(name || '').toLowerCase().split('.').pop();

function slotRefuses(key, name) {
  const ext = extOf(name);
  if (!/^(doc|docx)$/.test(ext)) return null;
  if (WORD_SLOTS.has(String(key))) return null;
  return '"' + String(name || 'That file').slice(0, 60) + '" is a Word file, and the '
    + DOCSLOTS.nameOf(key) + ' has to be a scan or a photo — PDF, JPG, PNG or HEIC.';
}

/* The first bytes look like text or HTML rather than any of the kinds above. */
function looksLikeText(b) {
  const head = b.slice(0, 64).toString('latin1').replace(/^﻿/, '').trimStart();
  return /^(<!doctype|<html|<script|<\?xml|<)/i.test(head);
}

/**
 * Why this file cannot be accepted today, or null when it can.
 *
 *   key    the slot it is in
 *   rec    the documents row (filename, bytes, verdict)
 *   head   optional: the first bytes of the file, when the caller has read
 *          them (the Accept routes and the sweep do; the listings do not)
 *
 * The cheap checks — extension, slot, size — need no disk read. The sniff
 * runs only when `head` is given; a listing that did not read the file
 * still shows a file the sweep sniffed, through the 'bad' verdict it left.
 */
function fails(key, rec, head) {
  const name = String((rec && rec.filename) || '');
  const ext = extOf(name);
  const kind = FILE_KINDS.find(k => k.ext.includes(ext));
  if (!kind) return 'not a PDF, photo or Word file';
  if (slotRefuses(key, name) || (ID_SLOTS.test(String(key)) && /^(doc|docx)$/.test(ext))) {
    return 'a Word file where a scan or photo is needed';
  }
  if (ext === 'pdf' && Number(rec.bytes) > 0 && Number(rec.bytes) < MIN_PDF_BYTES) return 'too small to be a document';
  if (head && head.length) {
    if (!kind.sig(head)) return looksLikeText(head) ? 'named as a ' + kind.what + ' but holds text or HTML' : 'named as a ' + kind.what + ' but is not one inside';
  } else if (String((rec && rec.verdict) || '') === 'bad') {
    return 'not a ' + kind.what + ' inside';
  }
  return null;
}

/** The first bytes of a stored file, or null when it cannot be read. */
function headOf(uploadDir, studentId, rec) {
  try {
    const file = path.join(uploadDir, String(studentId), String(rec.stored_name || ''));
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, 64, 0);
      return buf.slice(0, n);
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
}

/* What the screens say about one file. */
const STATE_SAID = {
  bad: 'Not accepted — not a PDF, photo or Word file',
  ok: 'Verified copy',
  rescan: 'Scan asked',
  replaced: 'Replaced by a newer accepted copy',
  wait: 'In review',
};

/**
 * A file's own display state: 'bad' | 'ok' | 'rescan' | 'replaced' | 'wait',
 * with the sentence for it. Patch 177 (item 4): the row's `status` IS its
 * own state (store.setFileState) — the slot's status is derived from the
 * rows and never consulted here. A file that fails today's checks is never
 * "verified", whatever anybody wrote on it. `legacyOk` is kept for callers
 * written before the rows carried their own answer: a row that still says
 * status 'ok' with no verdict is read as the verified copy.
 */
function stateOf(key, rec, legacyOk) {
  const why = fails(key, rec);
  if (why) return { state: 'bad', said: STATE_SAID.bad, why };
  const v = String((rec && rec.verdict) || '');
  const s = String((rec && rec.status) || '');
  if (v === 'ok' || s === 'ok' || (legacyOk && s === 'ok')) return { state: 'ok', said: STATE_SAID.ok, why: '' };
  if (v === 'rescan' || s === 'rescan') return { state: 'rescan', said: STATE_SAID.rescan, why: '' };
  if (s === 'replaced') return { state: 'replaced', said: STATE_SAID.replaced, why: '' };
  return { state: 'wait', said: STATE_SAID.wait, why: '' };
}

/**
 * THE SWEEP. Every file in a checklist slot is read (first bytes) and judged;
 * one that fails is marked verdict 'bad' (any 'ok' it carried comes off),
 * and a slot whose files are all bad goes back to 'wait'. Returns how many
 * files were newly marked. Logs one line when that is more than none.
 */
function sweep(db, uploadDir, log) {
  let marked = 0, slotsBack = 0, migrated = 0;
  let rows = [];
  try { rows = db.allDocFiles(); } catch (e) { return { marked, slotsBack, migrated }; }
  const setState = typeof db.setFileState === 'function'
    ? (rec, st) => { db.setFileState(rec.student_id, rec.id, st); rec.status = st; rec.verdict = st === 'ok' || st === 'rescan' || st === 'bad' ? st : ''; }
    : (rec, st) => { db.setFileVerdict(rec.student_id, rec.id, st === 'ok' || st === 'rescan' || st === 'bad' ? st : ''); rec.verdict = st; };
  /* Patch 177 (item 4): RECONCILE ROWS WRITTEN WHEN `status` WAS THE SLOT'S.
     The per-file `verdict` (patch 172) was always the truth about one file;
     the slot status was copied onto every row. So: a verdict says what the
     row is; a row with no verdict that reads 'ok' only because another row
     in the slot was accepted was never accepted itself and goes to review;
     a row with no verdict in a slot nobody accepted per file keeps the
     slot's old word (an accepted set stays accepted). Idempotent — under
     the new writes status and verdict never disagree. */
  const bySlot = new Map();
  for (const rec of rows) {
    const sk = rec.student_id + '\u0000' + String(rec.doc_key || '');
    if (!bySlot.has(sk)) bySlot.set(sk, []);
    bySlot.get(sk).push(rec);
  }
  for (const files of bySlot.values()) {
    const anyVerdictOk = files.some(f => String(f.verdict || '') === 'ok');
    for (const rec of files) {
      const v = String(rec.verdict || ''), s = String(rec.status || 'wait');
      let want = null;
      if (v === 'ok' && s !== 'ok') want = 'ok';
      else if (v === 'rescan' && s !== 'rescan') want = 'rescan';
      else if (v === 'bad' && s !== 'bad') want = 'bad';
      else if (v === '' && s === 'ok' && anyVerdictOk) want = 'wait';
      else if (v === '' && !['wait', 'rescan', 'ok', 'replaced', 'bad'].includes(s)) want = 'wait';
      if (want) { setState(rec, want); migrated += 1; }
    }
  }
  for (const rec of rows) {
    const key = String(rec.doc_key || '');
    const why = fails(key, rec, headOf(uploadDir, rec.student_id, rec));
    if (why && String(rec.status || '') !== 'bad') {
      setState(rec, 'bad');
      marked += 1;
    } else if (!why && String(rec.status || '') === 'bad') {
      /* A file the sweep once refused that passes now (the rules changed)
         goes back to review, not to accepted. */
      setState(rec, 'wait');
    }
  }
  if (marked && typeof log === 'function') log('[docs] ' + marked + ' file(s) marked not accepted');
  return { marked, slotsBack, migrated };
}

module.exports = { FILE_KINDS, FILE_LIST, WORD_SLOTS, ID_SLOTS, MIN_PDF_BYTES, slotRefuses, fails, headOf, stateOf, sweep, STATE_SAID };
