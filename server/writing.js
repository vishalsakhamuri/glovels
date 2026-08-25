'use strict';
/**
 * The SOP and LOR studio's writer.
 *
 * What this is, plainly: it assembles a draft from a bank of sentences and the
 * things the student actually entered. It is not a language model, and nothing
 * in the product says it is — the page calls it a draft, the disclaimer says it
 * uses only what was entered, and the paid service is a human rewrite. If an
 * API key is ever added, `draft()` is the one function to swap; everything
 * around it — the form, the saving, the counsellor's copy — stays.
 *
 * Two properties matter more than the prose:
 *
 *   Nothing is invented. Every concrete noun in the output came from a field
 *   the student filled in. The bank contributes structure and judgement, never
 *   evidence. This is why the studio can be trusted with an application.
 *
 *   Pressing "write it again" gives a different draft. The old version filled
 *   two slots in one fixed paragraph, so regenerating produced byte-identical
 *   text — the first thing anyone tries, and it made the whole feature look
 *   broken. Each pass walks the bank from a different offset.
 */

/* Placeholders that collapse rather than print a gap. A sentence whose
   placeholder has no value is dropped from the draft entirely: half a sentence
   with "as " dangling at the end is worse than one paragraph fewer. */
const FILL = /\{(programme|university|signals|details|motives|who|span|instance)\}/g;

const clean = (v, n) => String(v == null ? '' : v)
  .replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

/** "a, b and c" — the Oxford-less join people actually write. */
function join(a) {
  const x = a.filter(Boolean);
  if (!x.length) return '';
  if (x.length === 1) return x[0];
  return x.slice(0, -1).join(', ') + ' and ' + x[x.length - 1];
}

function fill(template, vals) {
  let missing = false;
  const out = template.replace(FILL, (_, k) => {
    const v = vals[k];
    if (!v) { missing = true; return ''; }
    return v;
  });
  return missing ? null : out;
}

/**
 * Pick from a list, walking forward by `pass`.
 *
 * Not random: the same inputs and the same pass give the same draft, which is
 * what makes this testable and what stops a student losing the version they
 * liked by pressing the button once more. Different passes give different
 * sentences, which is the whole point of the button.
 */
const pick = (list, pass, salt) =>
  (list && list.length) ? list[(pass + salt) % list.length] : null;

/**
 * Build a draft.
 *
 * @param bank    the `writing` content block — editable from the operations site
 * @param input   what the student typed and ticked
 * @param pass    0 for the first draft, 1 for "write it again", and so on
 */
function draft(bank, input, pass) {
  const kind = input.kind === 'lor' ? 'lor' : 'sop';
  const b = (bank && bank[kind]) || {};
  const p = Math.max(0, Math.min(999, Math.round(Number(pass) || 0)));

  const programme = clean(input.programme, 120);
  const university = clean(input.university, 120);

  /* Chips are matched against the bank by key, so a phrase edited in the office
     changes what the draft says without the page being rebuilt. A key that is
     not in the bank is ignored rather than trusted — the list of what may be
     said is the server's, not the browser's. */
  const byKey = (list, keys) => {
    const want = new Set((keys || []).map(k => clean(k, 40)));
    return (list || []).filter(c => want.has(c.key));
  };

  const picked = byKey(b.signals, input.signals);
  const signals = picked.map(c => c.phrase || c.label);
  const motives = kind === 'sop'
    ? byKey(b.motives, input.motives).map(c => c.phrase || c.label) : [];

  /*
   * What the student actually did, in their own words.
   *
   * Before this, a chip was a tick and nothing more: everyone who ticked "work
   * experience" got the sentence "my time working in a real team", and the
   * draft was structurally correct and evidentially empty. The chip now
   * carries a question, and the answer lands here.
   *
   * The detail is used VERBATIM — trimmed and length-capped, never rephrased.
   * That is the whole basis on which this studio can be pointed at a real
   * application: the page promises it will never invent a grade, a title or a
   * publication, and the way to keep that promise is to add nothing.
   *
   * Details for chips that were not ticked are dropped. A student who types
   * into a box, unticks the chip and presses write must not find the answer in
   * the draft anyway.
   */
  const given = (input.details && typeof input.details === 'object') ? input.details : {};
  const details = picked
    .map(c => {
      const said = clean(given[c.key], 300);
      /* An em dash, not a comma. The details are joined into one sentence with
         "a, b and c", and a comma between the phrase and its detail then reads
         as another item in that list. */
      return said ? (c.phrase || c.label) + ' — ' + said : '';
    })
    .filter(Boolean);

  const vals = {
    programme: programme || 'this programme',
    university: university || 'your chosen university',
    signals: join(signals),
    details: join(details),
    motives: join(motives),
    who: clean(input.who, 60),
    span: clean(input.span, 40),
    instance: clean(input.instance, 300),
  };

  const paras = [];
  const add = (list, salt) => {
    const t = pick(list, p, salt);
    if (!t) return;
    const s = fill(t, vals);
    if (s) paras.push(s);
  };

  /* The detail paragraph sits straight after the one that lists what was
     ticked, and collapses to nothing when no box was filled in — so a student
     who ticks and writes gets five paragraphs with evidence in them, and one
     who only ticks gets the four they got before. */
  if (kind === 'sop') {
    add(b.openings, 0);
    add(b.background, 1);
    add(b.detail, 5);
    add(b.motive, 2);
    add(b.fit, 3);
    add(b.closings, 4);
  } else {
    add(b.openings, 0);
    add(b.body, 1);
    add(b.detail, 5);
    add(b.instance, 2);
    add(b.closings, 3);
  }

  return {
    kind,
    pass: p,
    programme,
    university,
    paragraphs: paras,
    words: paras.join(' ').split(/\s+/).filter(Boolean).length,
    /* Said in the payload, not only in the page, so it travels with a saved
       draft and a counsellor opening it later sees the same caveat. */
    caveat: 'A draft, not a submission. It uses only what was entered — no grade, '
          + 'title, employer or publication has been added.',
  };
}

module.exports = { draft, join };
