'use strict';
/*
 * Copies of everything, because there is exactly one of it.
 *
 * The database is a file and so is every passport scan, and both live on one
 * disk on one host. Whatever else goes wrong on a launch day — and something
 * does — losing that disk is the one failure nothing else here can recover
 * from. So two things, neither needing a dependency:
 *
 *   1. A nightly copy of the database on the same disk, seven kept. This is
 *      not a backup against losing the disk; it is a backup against a bad
 *      import, a wrong delete, a migration that went sideways — yesterday's
 *      rows, one file away, without asking the host for anything.
 *
 *   2. A download, for an administrator, of the whole data directory as one
 *      .tar — the database snapshot, the uploads, the blog images, the mail
 *      settings. Taken off the host and kept somewhere else, this IS the
 *      backup against losing the disk. A tar rather than a zip because tar is
 *      five hundred bytes of header per file and nothing else, which is small
 *      enough to write here and be sure of.
 *
 * Restoring: stop the server, untar over the data directory, start it.
 */
const fs = require('fs');
const path = require('path');

const KEEP = 7;

/* A ustar header. Names longer than a hundred characters use the prefix
   field; nothing under data/ comes close, but the split is cheap. */
function header(name, size, mtime, type) {
  const buf = Buffer.alloc(512, 0);
  let file = name, prefix = '';
  if (Buffer.byteLength(file) > 100) {
    const i = file.lastIndexOf('/', 155);
    if (i > 0) { prefix = file.slice(0, i); file = file.slice(i + 1); }
  }
  buf.write(file, 0, 100);
  buf.write('0000644\0', 100);
  buf.write('0000000\0', 108);
  buf.write('0000000\0', 116);
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124);
  buf.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
  buf.write('        ', 148);                       // checksum, blank while summing
  buf.write(type, 156);
  buf.write('ustar\0', 257);
  buf.write('00', 263);
  buf.write(prefix, 345, 155);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return buf;
}

const pad = size => (size % 512 ? Buffer.alloc(512 - (size % 512), 0) : Buffer.alloc(0));

/** Every regular file under `dir`, as paths relative to it. */
function walk(dir, rel = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach(e => {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.isFile()) out.push(r);
  });
  return out;
}

function open({ db, dataDir, log = console }) {
  const dir = path.join(dataDir, 'backups');

  /**
   * Tonight's copy of the database, and the eighth-oldest one gone. Safe to
   * call as often as you like: one file per day, named for the day.
   */
  async function nightly() {
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const ext = db.kind === 'sqlite' ? '.db' : '.json';
    const file = path.join(dir, 'glovels-' + day + ext);
    const tmp = file + '.part';
    try { fs.unlinkSync(tmp); } catch (e) {}
    await db.snapshot(tmp);
    fs.renameSync(tmp, file);
    const old = fs.readdirSync(dir).filter(f => /^glovels-\d{4}-\d{2}-\d{2}\.(db|json)$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - KEEP)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    return file;
  }

  /** What is on the disk, for the Organisation screen. */
  function list() {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) {}
    return files.filter(f => /^glovels-\d{4}-\d{2}-\d{2}\.(db|json)$/.test(f)).sort().reverse()
      .map(f => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }));
  }

  /**
   * The whole data directory as a tar, written to `res`. The database goes
   * in as a fresh snapshot rather than the live file, which is mid-write
   * whenever the server is busy. The nightly copies are left out — they are
   * derived, and would multiply the download by eight.
   */
  async function tarTo(res, stamp) {
    const snap = path.join(dataDir, '.backup-' + process.pid + '.tmp');
    try { fs.unlinkSync(snap); } catch (e) {}
    await db.snapshot(snap);
    const dbName = db.kind === 'sqlite' ? 'glovels.db' : 'glovels-data.json';

    const files = walk(dataDir).filter(r =>
      !r.startsWith('backups/')
      && !r.startsWith('.backup-')
      && r !== dbName && r !== dbName + '-wal' && r !== dbName + '-shm' && r !== dbName + '-journal');

    res.writeHead(200, {
      'Content-Type': 'application/x-tar',
      'Content-Disposition': 'attachment; filename="glovels-backup-' + stamp + '.tar"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    const write = chunk => new Promise(resolve => {
      if (res.write(chunk)) resolve(); else res.once('drain', resolve);
    });
    const one = async (abs, name) => {
      const st = fs.statSync(abs);
      await write(header('data/' + name, st.size, st.mtimeMs, '0'));
      await new Promise((resolve, reject) => {
        const s = fs.createReadStream(abs);
        s.on('error', reject);
        s.on('end', resolve);
        s.pipe(res, { end: false });
      });
      await write(pad(st.size));
    };

    let count = 0;
    try {
      await one(snap, dbName); count++;
      for (const r of files) { await one(path.join(dataDir, r), r); count++; }
      await write(Buffer.alloc(1024, 0));        // two empty blocks end a tar
    } finally {
      try { fs.unlinkSync(snap); } catch (e) {}
      res.end();
    }
    return count;
  }

  /** Once soon after start, then every night — whichever host clock says. */
  function schedule() {
    const run = () => nightly().then(
      f => log.log('  backup ✓ ' + path.basename(f)),
      e => log.error('  backup ✗ ' + (e && e.message)));
    setTimeout(run, 5 * 60 * 1000).unref();
    setInterval(run, 24 * 60 * 60 * 1000).unref();
  }

  return { nightly, list, tarTo, schedule, dir };
}

module.exports = { open, header };
