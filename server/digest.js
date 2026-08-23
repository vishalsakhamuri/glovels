'use strict';
/**
 * One email a morning, to the people who can do something about it.
 *
 * The bell in the operations site tells somebody who is already looking. This
 * is for the deadline that arrives on a day nobody opens the screen — which is
 * the day it matters. A counsellor gets their own list; an administrator gets
 * the whole book plus the split by person, because "this counsellor has nine
 * students waiting on a reply" is an alert about a counsellor and is no use
 * only to them.
 *
 * Sent once a day and never twice. The last date sent is written to the
 * database rather than held in memory, so a restart — a deploy, a crash, a
 * host moving the container — does not send the morning's email again.
 *
 * With no SMTP configured the mailer writes .eml files to data/outbox, so this
 * works from the day it ships and starts arriving in inboxes the day the
 * details are filled in. Nothing here has to change for that.
 */

const ALERTS = require('./alerts.js');

const KEY = 'digestSentOn';
const CHECK_EVERY = 10 * 60 * 1000;      // ten minutes

/* India, where everybody reading this works. A digest that lands at 9am UTC
   arrives in the middle of the afternoon, by which time the person has either
   already found the problem or has not looked all day. */
const IST_OFFSET = 5.5 * 3600 * 1000;

const istHour = t => new Date(t + IST_OFFSET).getUTCHours();
const istDay = t => new Date(t + IST_OFFSET).toISOString().slice(0, 10);

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LABEL = {
  deadline: 'Deadlines', silent: 'Waiting for a reply', profile: 'Files not finished',
  followup: 'Follow-ups due', cold: 'Nobody has called', unassigned: 'No counsellor',
};

function group(list) {
  const out = {};
  list.forEach(a => { (out[a.kind] = out[a.kind] || []).push(a); });
  return out;
}

function body(name, list, byPerson) {
  const g = group(list);
  const order = ['deadline', 'silent', 'followup', 'cold', 'unassigned', 'profile'];
  const late = list.filter(a => a.urgency === 'now').length;

  const text = [
    'Good morning' + (name ? ' ' + name.split(' ')[0] : '') + '.',
    '',
    list.length + ' thing(s) need doing'
      + (late ? ', ' + late + ' of them already late' : '') + '.',
    '',
  ];
  const html = ['<p>Good morning' + (name ? ' ' + esc(name.split(' ')[0]) : '') + '.</p>',
    '<p><b>' + list.length + ' thing(s) need doing'
      + (late ? ', ' + late + ' of them already late' : '') + '.</b></p>'];

  for (const kind of order) {
    const rows = g[kind];
    if (!rows || !rows.length) continue;
    text.push((LABEL[kind] || kind).toUpperCase());
    html.push('<h3 style="margin:20px 0 8px;font:700 14px/1.3 system-ui,sans-serif;'
      + 'color:#0b1e31">' + esc(LABEL[kind] || kind) + '</h3><ul style="margin:0;'
      + 'padding-left:18px">');
    rows.slice(0, 12).forEach(a => {
      text.push('  · ' + a.title);
      text.push('    ' + a.detail);
      html.push('<li style="margin:0 0 7px;font:400 13.4px/1.6 system-ui,sans-serif;'
        + 'color:#13385c"><b>' + esc(a.title) + '</b><br>'
        + '<span style="color:#5b6b7c;font-size:12.6px">' + esc(a.detail)
        + '</span></li>');
    });
    if (rows.length > 12) {
      text.push('  … and ' + (rows.length - 12) + ' more');
      html.push('<li style="font:400 13px/1.6 system-ui,sans-serif;color:#5b6b7c">… and '
        + (rows.length - 12) + ' more</li>');
    }
    text.push('');
    html.push('</ul>');
  }

  if (byPerson && byPerson.length) {
    text.push('BY PERSON');
    html.push('<h3 style="margin:20px 0 8px;font:700 14px/1.3 system-ui,sans-serif;'
      + 'color:#0b1e31">By person</h3><ul style="margin:0;padding-left:18px">');
    byPerson.forEach(p => {
      text.push('  · ' + p.name + ': ' + p.total
        + (p.now ? ' (' + p.now + ' late)' : ''));
      html.push('<li style="margin:0 0 5px;font:400 13.2px/1.6 system-ui,sans-serif">'
        + esc(p.name) + ': <b>' + p.total + '</b>'
        + (p.now ? ' — ' + p.now + ' late' : '') + '</li>');
    });
    text.push('');
    html.push('</ul>');
  }

  return { text: text.join('\n'), html: html.join('') };
}

/**
 * Who gets what, worked out once.
 *
 * Exported so a test can ask for this morning's emails without waiting for
 * this morning, and without sending anything.
 */
function plan(db, now) {
  const { alerts } = ALERTS.all(db, now);
  if (!alerts.length) return [];

  const staff = db.counsellors().concat(db.staffByRole('admin'));
  const out = [];

  for (const person of staff) {
    const isAdmin = person.role === 'admin';
    const mine = isAdmin
      ? alerts
      : alerts.filter(a => a.who == null || Number(a.who) === Number(person.id));
    if (!mine.length) continue;

    const byPerson = isAdmin
      ? Object.values(mine.reduce((m, a) => {
          const k = String(a.who || 'nobody');
          if (!m[k]) {
            const p = a.who ? db.studentById(a.who) : null;
            m[k] = { name: p ? p.name : 'Nobody assigned', now: 0, total: 0 };
          }
          m[k].total++;
          if (a.urgency === 'now') m[k].now++;
          return m;
        }, {})).sort((x, y) => y.now - x.now || y.total - x.total)
      : [];

    const late = mine.filter(a => a.urgency === 'now').length;
    out.push({
      to: person.email,
      name: person.name,
      count: mine.length,
      late,
      subject: late
        ? late + ' late · ' + mine.length + ' thing(s) need doing today'
        : mine.length + ' thing(s) need doing today',
      body: body(person.name, mine, byPerson),
    });
  }
  return out;
}

/**
 * Start the timer.
 *
 * Returns a stop function, which the tests use and nothing else does.
 */
function start({ db, mail, siteUrl, hour, shell }) {
  const at = hour == null ? 9 : Number(hour);       // 9am, India

  async function tick() {
    const t = Date.now();
    if (istHour(t) !== at) return;
    const today = istDay(t);
    let sent = null;
    try { sent = db.content(KEY); } catch (e) { /* first run */ }
    if (sent && sent.on === today) return;
    /* Written BEFORE sending, not after. A mailer that throws halfway through
       eight recipients must not send the first four of them again in ten
       minutes' time. */
    db.setContent(KEY, { on: today }, 'system');

    const jobs = plan(db, t);
    for (const j of jobs) {
      try {
        await mail.send({
          to: j.to,
          subject: j.subject,
          text: j.body.text + '\n\nOpen the operations site: ' + (siteUrl || '') + '/admin\n',
          html: shell
            ? shell('What needs doing', j.body.html
                + '<p style="margin-top:22px"><a href="' + esc(siteUrl || '') + '/admin" '
                + 'style="font-weight:700;color:#13385c">Open the operations site</a></p>')
            : j.body.html,
        });
      } catch (e) {
        /* One bad address must not stop the other seven. */
        console.error('  digest to ' + j.to + ' failed:', e && e.message);
      }
    }
    if (jobs.length) {
      db.log('system', 'daily digest sent', jobs.length + ' person(s)');
    }
  }

  const timer = setInterval(() => { tick().catch(() => {}); }, CHECK_EVERY);
  if (timer.unref) timer.unref();
  /* Once at boot as well: a container that restarts at 9:02 would otherwise
     wait until tomorrow. */
  tick().catch(() => {});
  return () => clearInterval(timer);
}

module.exports = { start, plan, body, istHour, istDay, KEY };
