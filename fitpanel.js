/*
 * FIND WHAT FITS — the finder's filters, for staff, with the names (patch 147).
 *
 * "We hide the university shortlist until paid by student, so we need these
 *  proper filters to work in the counsellor and admin panel so that
 *  shortlisting of the unis can be tested."
 *
 * One panel, two screens:
 *   counsellor  starts from the open student's profile; Add puts a programme
 *               on their list.
 *   catalogue   (admin) a profile typed in by hand — to test what a package
 *               would deliver without a student, a payment or a shortlist.
 *
 * Every answer comes from the server's matcher (server/matches.js screen and
 * plan), the same code that delivers the paid shortlist — so what passes here
 * is exactly what a student would be given, and every "no" says why.
 *
 *   GlovelsFit.mount(element, {
 *     profile,                 // the starting answers (the student's profile)
 *     run(filters) -> Promise, // the server's answer for these filters
 *     onAdd(id) -> Promise,    // optional: put one on the student's list
 *     note                     // optional: a line above the form
 *   })
 */
(function () {
  'use strict';
  /* The same field names the home page's dropdown offers (patch 153 added the
   * seventeen engineering, health, science and business ones), kept
   * alphabetical so a counsellor finds them where they expect. */
  const FIELDS = ['Aerospace & Robotics', 'Agriculture & Food Science', 'Animation, Film & Game Design',
    'Architecture, Urban Planning & Built Environment', 'Arts & Design', 'Biomedical Engineering',
    'Biotechnology & Bioinformatics', 'Business & Management', 'Chemical & Process Engineering',
    'Civil & Construction Engineering', 'Computer Science & IT', 'Cybersecurity & Cloud',
    'Data Science, AI & Machine Learning', 'Earth Sciences & Geology', 'Economics', 'Education & Teaching',
    'Electrical & Electronics Engineering', 'Environmental Science & Sustainability', 'Fashion & Luxury Management',
    'Finance, Banking & Accounting', 'Hospitality, Tourism & Events', 'Humanities & Languages',
    'Industrial & Manufacturing Engineering', 'International Relations & Public Policy', 'Law & Legal Studies',
    'MBA', 'Marine & Naval Engineering', 'Marketing & Digital Media', 'Materials Science & Engineering',
    'Mathematics, Statistics & Actuarial Science', 'Mechanical & Automotive Engineering', 'Mechatronics, Robotics & Automation',
    'Media & Communication', 'Medicine, Dentistry & Allied Health', 'Mining, Petroleum & Energy Engineering',
    'Natural Sciences (Physics, Chemistry, Maths)', 'Nursing & Allied Health Sciences', 'Pharmacy & Pharmaceutical Sciences',
    'Psychology', 'Public Health & Healthcare Management', 'Real Estate & Property Management', 'Renewable Energy',
    'Social Sciences & Social Work', 'Sport & Exercise Science', 'Supply Chain, Logistics & Operations',
    'Veterinary & Animal Sciences'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lakh = n => n ? '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : '₹0 tuition';

  /* This semester, next semester and the two after — the terms the finder offers. */
  function terms() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const out = [];
    for (let y = t.getFullYear(); out.length < 4; y++) {
      [['Summer', 3], ['Winter', 9]].forEach(([s, m]) => {
        if (out.length < 4 && new Date(y, m, 1) > t) out.push(s + ' ' + y);
      });
    }
    return out;
  }
  function nextDeadline(intakes, intakeText) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = /(summer|winter)\D{0,3}(\d{4})/i.exec(String(intakeText || ''));
    const list = (intakes || []).filter(i => i && i.deadline).map(i => {
      const d = new Date(i.deadline); if (isNaN(d)) return null;
      let at;
      if (m) {
        const se = /summer|spring/i.test(String(i.season || '')) ? 'summer' : 'winter';
        if (se !== m[1].toLowerCase()) return null;
        const y = Number(m[2]), start = new Date(y, se === 'summer' ? 3 : 9, 1);
        const limit = new Date(start); limit.setMonth(limit.getMonth() + 1);
        at = new Date(y, d.getMonth(), d.getDate());
        while (at > limit) at.setFullYear(at.getFullYear() - 1);
      } else {
        at = new Date(today.getFullYear(), d.getMonth(), d.getDate());
        if (at < today) at.setFullYear(at.getFullYear() + 1);
      }
      return at >= today ? at : null;
    }).filter(Boolean).sort((a, b) => a - b);
    return list[0] ? list[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  const CSS = '.gf{font:400 13px/1.45 var(--sans,system-ui)}.gf .gf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 10px}'
    + '.gf label{display:block;font:700 10.5px/1.3 var(--sans,system-ui);text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#5d6b7a);margin-bottom:3px}'
    + '.gf input,.gf select{width:100%;padding:7px 9px;font:400 12.6px/1.3 var(--sans,system-ui);border:1.5px solid #d8dde4;border-radius:8px;background:#fff;box-sizing:border-box}'
    + '.gf .gf-row{display:flex;gap:6px}.gf .gf-row>*{flex:1;min-width:0}'
    + '.gf h4{margin:16px 0 6px;font-size:13.4px}.gf ul{list-style:none;margin:0;padding:0}'
    + '.gf li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line,#e6e9ee)}'
    + '.gf li .m{flex:1;min-width:0}.gf li b{display:block;font-size:13px}.gf small{display:block;color:var(--muted,#5d6b7a);font-size:11.8px}'
    + '.gf .why{color:#b42318;font-weight:600}.gf .soft{color:#8a6a1f;font-weight:600}.gf .ask{color:#8a6a1f}.gf .tag{display:inline-block;font:700 10.5px/1.5 var(--sans,system-ui);padding:0 7px;border-radius:999px;background:#eef2f6;margin-right:4px}'
    + '.gf .auto{background:#f5f8fb;border:1px solid var(--line,#e6e9ee);border-radius:10px;padding:10px 12px;margin-top:12px}'
    + '.gf .sum{margin-top:10px;color:var(--muted,#5d6b7a);font-size:12.2px}';

  function mount(el, o) {
    if (!el) return;
    if (!document.getElementById('gf-css')) {
      const st = document.createElement('style'); st.id = 'gf-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const P = Object.assign({}, o.profile || {});
    const sel = (id, opts, val) => '<select id="' + id + '">' + opts.map(([v, t]) =>
      '<option value="' + esc(v) + '"' + (String(v) === String(val || '') ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
    const lv = /mba/i.test(P.g_level || '') ? "MBA" : /bachelor/i.test(P.g_level || '') ? "Bachelor's" : /found|pathway/i.test(P.g_level || '') ? 'Foundation' : "Master's";
    const eng = /toefl/i.test(P.e_test || '') ? 'TOEFL' : /ielts/i.test(P.e_test || '') ? 'IELTS' : /medium of instruction|^moi/i.test(P.e_test || '') ? 'Medium of Instruction letter' : /not taken/i.test(P.e_test || '') ? 'Not taken yet' : '';
    const gre = /^gre$/i.test(P.a_test || '') ? 'GRE' : /^(not taken|not taken yet|not required)$/i.test(P.a_test || '') ? 'Not taken yet' : '';
    const intake = terms().find(t => t.toLowerCase() === String(P.g_intake || '').toLowerCase()) || '';
    el.innerHTML = '<div class="gf">'
      + (o.note ? '<p style="margin:0 0 10px;color:var(--muted,#5d6b7a);font-size:12.4px">' + o.note + '</p>' : '')
      + '<div class="gf-grid">'
      + '<div><label>Destination</label><input id="gfCountry" list="gfCountries" value="' + esc(P.g_country || 'Germany') + '">'
      + '<datalist id="gfCountries">' + ['Germany', 'United Kingdom', 'Ireland', 'Canada', 'Italy', 'Poland', 'Spain', 'France', 'Netherlands', 'United States', 'Australia', 'New Zealand'].map(c => '<option value="' + c + '">').join('') + '</datalist></div>'
      + '<div><label>Level</label>' + sel('gfLevel', [["Master's", "Master's"], ['MBA', 'MBA'], ["Bachelor's", "Bachelor's"], ['Foundation', 'Foundation']], lv) + '</div>'
      + '<div><label>Field (exact)</label>' + sel('gfField', [['', 'From their profile']].concat(FIELDS.map(f => [f, f])), '') + '</div>'
      + '<div><label>Their field, in words</label><input id="gfWords" value="' + esc([P.g_field, P.g_field2].filter(Boolean).join(', ')) + '" placeholder="Data Science, AI"></div>'
      + '<div><label>Intake</label>' + sel('gfIntake', [['', 'Any intake']].concat(terms().map((t, i) => [t, (i === 0 ? 'This semester — ' : i === 1 ? 'Next semester — ' : '') + t])), intake) + '</div>'
      + '<div><label>Public or private</label>' + sel('gfKind', [['any', 'Both'], ['public', 'Public'], ['private', 'Private']], 'any') + '</div>'
      + '<div><label>Budget (total)</label>' + sel('gfBudget', [['', 'From their profile'], ['0', 'No ceiling'], ['1000000', 'Under ₹10L'], ['2000000', 'Under ₹20L'], ['4000000', 'Under ₹40L']], '') + '</div>'
      + '<div><label>Name contains</label><input id="gfQ" placeholder="TUM, Data, Berlin"></div>'
      + '<div><label>Specialisation</label><input id="gfSpec" placeholder="Embedded Systems"></div>'
      + '<div><label>Tuition per semester</label>' + sel('gfTuition', [['', 'Any tuition'], ['0', 'No tuition fee'], ['500', 'Up to €500'], ['1500', 'Up to €1,500'], ['4000', 'Up to €4,000'], ['6000', 'Up to €6,000']], '') + '</div>'
      + '<div><label>CGPA · out of · pass</label><div class="gf-row"><input id="gfCgpa" value="' + esc(P.d_cgpa || '') + '" inputmode="decimal"><input id="gfMax" value="' + esc(P.d_max || '10') + '" inputmode="decimal"><input id="gfPass" value="' + esc(P.d_pass || '') + '" inputmode="decimal" placeholder="pass"></div></div>'
      + '<div><label>Their bachelor’s</label><input id="gfBach" value="' + esc(P.d_course || '') + '" placeholder="B.Tech CSE"></div>'
      + '<div><label>German grade (1.0 best)</label><input id="gfGgpa" inputmode="decimal" placeholder="worked out from CGPA"></div>'
      + '<div><label>Bachelor’s length</label>' + sel('gfDur', [['', 'Not said'], ['3 years', '3 years'], ['4 years', '4 years'], ['5 years', '5 years']], (/(\d)/.exec(P.d_dur || '') || [])[1] ? (/(\d)/.exec(P.d_dur)[1] + ' years') : '') + '</div>'
      + '<div><label>English test · score</label><div class="gf-row">' + sel('gfEng', [['', 'Not said'], ['IELTS', 'IELTS'], ['TOEFL', 'TOEFL'], ['Medium of Instruction letter', 'MOI letter'], ['Not taken yet', 'Not taken']], eng) + '<input id="gfEngS" value="' + esc(P.e_score || '') + '" inputmode="decimal"></div></div>'
      + '<div><label>GRE · score</label><div class="gf-row">' + sel('gfGre', [['', 'Not said'], ['GRE', 'Taken'], ['Not taken yet', 'Not taken']], gre) + '<input id="gfGreS" value="' + esc(gre === 'GRE' ? (P.a_score || '') : '') + '" inputmode="numeric" placeholder="e.g. 315"></div></div>'
      /* Patch 153 — the home page's "More filters" controls, so the counsellor
       * can test exactly what a student would see. The GRE section row only
       * appears once a GRE score is typed (a section score without a total is
       * a question the server would not ask). */
      + '<div id="gfGreSecWrap"' + (gre === 'GRE' && P.a_score ? '' : ' hidden') + '><label>GRE quant · verbal · AWA</label><div class="gf-row">'
      + '<input id="gfGreQ" value="' + esc(P.a_quant || '') + '" inputmode="numeric" placeholder="Q">'
      + '<input id="gfGreV" value="' + esc(P.a_verbal || '') + '" inputmode="numeric" placeholder="V">'
      + '<input id="gfGreA" value="' + esc(P.a_awa || '') + '" inputmode="decimal" placeholder="AWA"></div></div>'
      + '<div><label>Bachelor’s ECTS</label>' + sel('gfEcts', [['', 'Not said'], ['180', '180 (3-year)'], ['210', '210'], ['240', '240 (4-year)']], P.d_ects || '') + '</div>'
      + '<div><label>Class rank</label>' + sel('gfTop', [['', 'Not said'], ['5', 'Top 5%'], ['10', 'Top 10%'], ['20', 'Top 20%'], ['30', 'Top 30%'], ['50', 'Top 50%'], ['100', 'Below 50%']], P.d_top || '') + '</div>'
      + '<div><label>Restricted admission</label>' + sel('gfRestricted', [['', 'Show all'], ['open', 'Only open admission'], ['restricted', 'Only restricted']], /^no$/i.test(P.g_restricted || '') ? 'open' : '') + '</div>'
      + '<div><label>Application fee</label>' + sel('gfFee', [['', 'Any application'], ['free', 'Free to apply'], ['package', 'Comes with a package']], '') + '</div>'
      + '<div><label>German level</label>' + sel('gfGer', [['', 'Not said'], ['None yet', 'None'], ['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1'], ['C2', 'C2']], P.g_german || '') + '</div>'
      + '<div><label>Published a paper</label>' + sel('gfPapers', [['', 'Not said'], ['Yes', 'Yes'], ['No', 'No']], /^yes/i.test(P.g_papers || '') ? 'Yes' : /^no/i.test(P.g_papers || '') ? 'No' : '') + '</div>'
      + '<div><label>Work experience (months)</label><input id="gfWork" value="' + esc(/^no$/i.test(P.w_has || '') ? '0' : (P.w_months || '')) + '" inputmode="numeric" placeholder="not said"></div>'
      + '</div>'
      + '<p style="margin:10px 0 0"><button type="button" class="btn btn-primary btn-sm" id="gfGo">Find what fits</button>'
      + ' <span style="font-size:11.8px;color:var(--muted,#5d6b7a)">Nothing here is saved to the student’s file.</span></p>'
      + '<div id="gfOut"></div></div>';

    const v = id => (el.querySelector('#' + id) || {}).value || '';
    const filters = () => {
      const f = {
        g_country: v('gfCountry'), g_level: v('gfLevel'), g_field: v('gfWords'), g_field2: '',
        g_intake: v('gfIntake'), field: v('gfField'), kind: v('gfKind'), q: v('gfQ'),
        d_cgpa: v('gfCgpa'), d_max: v('gfMax'), d_pass: v('gfPass'), d_course: v('gfBach'), d_dur: v('gfDur'),
        e_test: v('gfEng'), e_score: /medium of instruction|not taken/i.test(v('gfEng')) ? '' : v('gfEngS'), g_german: v('gfGer'),
        a_test: v('gfGre'), a_score: v('gfGre') === 'GRE' ? v('gfGreS') : '',
      };
      if (v('gfBudget') !== '') f.ceiling = v('gfBudget');
      if (v('gfSpec').trim()) f.spec = v('gfSpec').trim();
      if (v('gfTuition') !== '') f.tuitionMax = v('gfTuition');
      if (v('gfGgpa').trim()) f.ggpa = v('gfGgpa').trim().replace(',', '.');
      f.g_papers = v('gfPapers');
      const wk = v('gfWork');
      if (wk !== '') { f.w_has = Number(wk) > 0 ? 'Yes' : 'No'; f.w_months = wk; }
      /* Patch 153 — the section scores travel only with a GRE total, the way
       * the home page sends them; the rest are the student's profile keys the
       * matcher reads (answersOf) plus the two screen-side filters. "Only open
       * admission" is both: the server drops restricted rows (restricted='no')
       * and the student is marked as not accepting them (g_restricted='no'). */
      const gre = v('gfGre') === 'GRE';
      f.a_quant = gre ? v('gfGreQ').trim() : '';
      f.a_verbal = gre ? v('gfGreV').trim() : '';
      f.a_awa = gre ? v('gfGreA').trim().replace(',', '.') : '';
      f.d_ects = v('gfEcts');
      f.d_top = v('gfTop');
      const rs = v('gfRestricted');
      f.g_restricted = rs === 'open' ? 'no' : '';
      f.restricted = rs === 'open' ? 'no' : rs === 'restricted' ? 'yes' : '';
      f.feeModel = v('gfFee');
      f.limit = 500;
      return f;
    };
    /* The GRE section row has nothing to say until there is a GRE score. */
    const greSections = () => {
      const w = el.querySelector('#gfGreSecWrap');
      if (w) w.hidden = v('gfGre') !== 'GRE';   /* patch 156: open on "Taken" */
    };
    el.addEventListener('input', e => { if (e.target.closest('#gfGre, #gfGreS')) greSections(); });
    el.addEventListener('change', e => { if (e.target.closest('#gfGre, #gfGreS')) greSections(); });

    /* Patch 153 (K) — one muted line of the special conditions a counsellor
     * must know about before promising a place: "Restrictions: No" when the
     * row is clear-cut, otherwise the conditions in plain words. Built from
     * what the server says about this row — the restricted flag, the notes
     * from check() and the unknowns it would ask the student. */
    const restrictions = r => {
      const out = [];
      if (r.restricted) out.push('restricted admission (ranked, limited places)');
      (r.notes || []).forEach(n => {
        if (/moi/i.test(n)) out.push('English accepted via MOI letter');
        else if (!/restricted/i.test(n)) out.push(String(n));
      });
      const reqs = r.reqs || {};
      (r.ask || []).forEach(a => {
        if (/gre section/i.test(a)) out.push('GRE section scores needed');
        else if (/class rank/i.test(a) && reqs.topPercent) out.push('class rank top ' + reqs.topPercent + '% required');
        else out.push('tell us your ' + a + ' to confirm');
      });
      return out.length ? out.join(', ') : 'No';
    };
    const feeOf = r => (r.feeModel || (r.isPublic ? 'package' : 'free')) === 'free' ? 'Free to apply' : 'With a package';
    const item = (r, onList, canAdd) => '<li><div class="m"><b>' + esc(r.university)
      + (r.restricted ? ' <span class="tag">Restricted</span>' : '') + '</b>'
      + '<small>' + esc(r.program) + ' · ' + (r.isPublic ? 'Public' : 'Private') + ' · ' + feeOf(r) + ' · ' + esc(r.city || '') + ' · ' + lakh(r.totalInr)
      + (nextDeadline(r.intakes, v('gfIntake')) ? ' · closes ' + nextDeadline(r.intakes, v('gfIntake')) : '') + '</small>'
      + (r.why && r.why.length ? '<small class="why">' + esc(r.why.join('; ')) + '</small>' : '')
      /* Patch 162: short of something stated — on the list, ranked lower, the
         counsellor's call. */
      + (r.soft && r.soft.length ? '<small class="soft">Lower priority — ' + esc(r.soft.join('; ')) + '</small>' : '')
      + (r.ask && r.ask.length ? '<small class="ask">Not known yet: ' + esc(r.ask.join(', ')) + '</small>' : '')
      + (r.notes && r.notes.length ? '<small>' + esc(r.notes.join(' · ')) + '</small>' : '')
      + '<small>Restrictions: ' + esc(restrictions(r)) + '</small>'
      + '</div>' + (onList.has(String(r.id)) ? '<span class="tag">on their list</span>'
        : canAdd ? '<button type="button" class="btn btn-ghost btn-sm" data-gfadd="' + esc(r.id) + '">Add</button>' : '')
      + '</li>';

    async function go() {
      const out = el.querySelector('#gfOut');
      out.innerHTML = '<p class="sum">Checking every programme against the same rules the paid shortlist uses…</p>';
      let d;
      try { d = await o.run(filters()); } catch (e) { out.innerHTML = '<p class="why">' + esc(e.message || 'Could not run that.') + '</p>'; return; }
      const onList = new Set((d.onList || []).map(String));
      const canAdd = typeof o.onAdd === 'function';
      const auto = (d.auto || []).map(a => '<div><b>' + esc(a.package || a.kind) + '</b> — '
        + (a.picks.length ? a.picks.length + ' of ' + a.count + ': ' + a.picks.map(p => esc(p.university)).join(', ') : 'nothing fits yet')
        + (a.note ? '<small>' + esc(a.note) + '</small>' : '') + '</div>').join('');
      out.innerHTML = '<p class="sum">' + d.counts.looked + ' programmes in that field and level · <b>' + d.counts.fits + ' fit</b> · '
        + d.counts.near + ' miss on one thing' + (d.counts.unknownDates ? ' · ' + d.counts.unknownDates + ' publish no dates' : '') + '</p>'
        + (d.usable === false ? '<p class="why">The matcher needs a level and a field before it picks a paid list.</p>' : '')
        + (auto ? '<div class="auto"><b style="display:block;margin-bottom:4px">What a package would deliver now'
          + (d.bought === false ? ' (not bought yet)' : '') + '</b>' + auto + '</div>' : '')
        + '<h4>Fits (' + d.fits.length + (d.counts.fits > d.fits.length ? ' of ' + d.counts.fits : '') + ')</h4>'
        + (d.fits.length ? '<ul>' + d.fits.map(r => item(r, onList, canAdd)).join('') + '</ul>' : '<p class="sum">Nothing fits every answer.</p>')
        + '<h4>Misses on one thing (' + d.near.length + ')</h4>'
        + (d.near.length ? '<ul>' + d.near.map(r => item(r, onList, canAdd)).join('') + '</ul>' : '<p class="sum">None.</p>');
    }
    el.addEventListener('click', async e => {
      if (e.target.closest('#gfGo')) { go(); return; }
      const add = e.target.closest('[data-gfadd]');
      if (add && o.onAdd) {
        add.disabled = true;
        try { await o.onAdd(add.dataset.gfadd); add.outerHTML = '<span class="tag">on their list</span>'; }
        catch (err) { add.disabled = false; add.insertAdjacentHTML('afterend', '<small class="why">' + esc(err.message || 'Could not add it.') + '</small>'); }
      }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('input')) { e.preventDefault(); go(); } });
    if (o.autorun) go();
  }
  window.GlovelsFit = { mount };
})();
