'use strict';
/**
 * Live updates.
 *
 * Server-sent events, not polling and not websockets.
 *
 * Polling was the alternative and it is worse in both directions: at a sensible
 * interval a reply takes seconds to appear, and at a snappy interval every idle
 * tab hammers the server for nothing. Websockets would work, but they need a
 * protocol upgrade, a framing implementation and a heartbeat of their own —
 * for a stream that only ever flows server → client, that is a lot of moving
 * parts to get a one-way pipe.
 *
 * SSE is one HTTP response left open. The browser's EventSource reconnects by
 * itself if it drops, which is most of the hard part done for free.
 *
 * A comment line every 25 seconds keeps proxies from closing an idle stream.
 */

class Live {
  constructor() {
    /** studentId -> Set of open responses (a student may have two tabs open) */
    this.students = new Map();
    /** staffId -> Set of open responses */
    this.staff = new Map();
    /** chat token -> Set of open responses. A visitor on the marketing site has
        no account, so their channel is keyed by the token in their cookie. */
    this.guests = new Map();
    this.heartbeat = setInterval(() => this.ping(), 25000);
    this.heartbeat.unref && this.heartbeat.unref();
  }

  _add(map, key, res) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(res);
  }

  _drop(map, key, res) {
    const set = map.get(key);
    if (!set) return;
    set.delete(res);
    if (!set.size) map.delete(key);
  }

  /** Open a stream for whoever this is. Returns nothing — the response stays open. */
  subscribe(req, res, who) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',        // tell nginx not to buffer this, when there is one
    });
    res.write('retry: 3000\n\n');       // how long the browser waits before reconnecting

    const map = who.role === 'student' ? this.students
              : who.role === 'guest' ? this.guests : this.staff;
    this._add(map, who.id, res);

    const close = () => { this._drop(map, who.id, res); };
    req.on('close', close);
    req.on('error', close);
    res.on('error', close);

    this._write(res, 'hello', { at: new Date().toISOString(), as: who.role });
  }

  _write(res, event, data) {
    try {
      res.write('event: ' + event + '\n');
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    } catch (e) { /* the client vanished; the close handler will tidy up */ }
  }

  ping() {
    const all = [...this.students.values(), ...this.staff.values(), ...this.guests.values()];
    all.forEach(set => set.forEach(res => {
      try { res.write(': ping\n\n'); } catch (e) {}
    }));
  }

  /** Everyone watching this student's thread: the student, and their counsellor. */
  toThread(studentId, counsellorId, event, data) {
    (this.students.get(Number(studentId)) || new Set()).forEach(res => this._write(res, event, data));
    if (counsellorId) {
      (this.staff.get(Number(counsellorId)) || new Set()).forEach(res => this._write(res, event, data));
    }
    // an admin watching gets it too, so oversight is actually live
    this.staff.forEach((set, id) => {
      if (Number(id) === Number(counsellorId)) return;
      set.forEach(res => this._write(res, event, data));
    });
  }

  toStudent(studentId, event, data) {
    (this.students.get(Number(studentId)) || new Set()).forEach(res => this._write(res, event, data));
  }

  toStaff(staffId, event, data) {
    (this.staff.get(Number(staffId)) || new Set()).forEach(res => this._write(res, event, data));
  }

  /** Every member of staff who has the operations site open. A visitor chat is
      not assigned to anyone yet, so whoever is at a desk should see it. */
  toAllStaff(event, data) {
    this.staff.forEach(set => set.forEach(res => this._write(res, event, data)));
  }

  /** The visitor on the other end of one chat, in however many tabs. */
  toGuest(token, event, data) {
    (this.guests.get(String(token)) || new Set()).forEach(res => this._write(res, event, data));
  }

  /** Who is currently connected — used to decide whether to send an email too. */
  isOnline(role, id) {
    const map = role === 'student' ? this.students : this.staff;
    return (map.get(Number(id)) || new Set()).size > 0;
  }

  counts() {
    return { students: this.students.size, staff: this.staff.size, guests: this.guests.size };
  }
}

module.exports = { Live };
