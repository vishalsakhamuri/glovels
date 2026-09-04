"""
Dashboard-only CSS.

The newer dashboard markup (top bar, plan badge, counsellor card, four-step
strip, next-up prompt, vertical shortlist) shipped without the rules that style
it, so every one of those blocks rendered as unstyled stacked text on top of an
otherwise finished screen. These are the missing rules, written against the same
tokens as the rest of the portal.

Injected at build time rather than pasted into dashboard.html, so a fresh copy
of that file from the designer can be dropped in and rebuilt.
"""

CSS = """
/* ---- injected by build_portal.py: rules the newer dashboard markup needs ---- */

/* Top bar: page title, notifications, avatar. */
.p-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.p-bar-title{font:800 11.4px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase;
  color:var(--muted)}
.p-bell{margin-left:auto;position:relative;width:36px;height:36px;border-radius:50%;
  border:1px solid var(--line);background:var(--paper);color:var(--navy-700);cursor:pointer;
  display:grid;place-items:center;transition:.16s}
.p-bell:hover{border-color:var(--blue);color:var(--blue-deep)}
.p-bell .dot{position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;
  background:var(--gold-deep);border:1.5px solid var(--paper)}
.p-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
  font:700 12.4px/1 var(--sans);color:#fff;
  background:linear-gradient(160deg,var(--navy-600),var(--navy-800))}

/* The package the student is actually on, in the sidebar under the logo. */
.plan-badge{margin:14px 14px 0;padding:11px 13px;border-radius:12px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14)}
.plan-badge b{display:block;font:700 13px/1.25 var(--sans);color:#fff}
.plan-badge span{display:block;margin-top:3px;font-size:11.4px;line-height:1.4;
  color:rgba(255,255,255,.62)}

/* Sign out, beside their own name, at the TOP of the sidebar. It used to sit
   at the bottom of the nav, which on a laptop is below the fold and on a phone
   is under the entire menu — so the way to leave was the one thing on the
   screen you had to go looking for. */
.p-who{margin:14px 14px 0;padding:11px 13px;border-radius:12px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);
  display:flex;align-items:center;gap:10px}
.p-who > b{flex:1;min-width:0;font:700 13px/1.25 var(--sans);color:#fff;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p-out{display:inline-flex;align-items:center;gap:6px;flex:none;
  font:700 11.6px/1 var(--sans);color:rgba(255,255,255,.72);
  padding:6px 9px;border-radius:8px;text-decoration:none;
  border:1px solid rgba(255,255,255,.18);transition:color .12s, background .12s}
.p-out:hover{color:#fff;background:rgba(255,255,255,.12)}
.p-out .ico{width:13px;height:13px}
.plan-badge .p-out{margin-left:auto;align-self:flex-start}
.plan-badge{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.plan-badge b, .plan-badge > span{flex-basis:100%}
.plan-badge .p-out{flex-basis:auto}
@media (max-width:900px){
  .p-who, .plan-badge{margin:10px 12px 0}
}

/* "Do this next." One prompt, and it has to look like the most actionable thing
   on the page — otherwise it is just another card. */
.nextup{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  background:linear-gradient(120deg,#f4f8ff,#eef3fc);
  border:1.5px solid #c9dbf7;border-radius:var(--r-lg,16px);padding:16px 18px;
  margin-bottom:20px;box-shadow:var(--sh-1,0 2px 10px rgba(11,30,49,.06))}
.nextup>.ico{font-size:26px;color:var(--blue-deep);flex:none}
.nextup>div{flex:1;min-width:220px}
.nextup b{display:block;font-family:var(--disp);font-size:16px;color:var(--navy-900);
  margin-bottom:3px}
.nextup span{font-size:12.8px;line-height:1.55;color:var(--muted)}
.nextup .btn{flex:none}

/* Counsellor card. */
.couns{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  background:var(--paper);border:1px solid var(--line);border-radius:var(--r-lg,16px);
  padding:15px 17px;box-shadow:var(--sh-1,0 2px 10px rgba(11,30,49,.06))}
.couns .c-av{width:44px;height:44px;border-radius:50%;flex:none;display:grid;place-items:center;
  font:700 14px/1 var(--sans);color:#fff;
  background:linear-gradient(160deg,var(--navy-600),var(--navy-800))}
.couns>div{flex:1;min-width:150px}
.c-lbl{display:block;font:800 9.6px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted);margin-bottom:4px}
.couns b{display:block;font-size:14px;color:var(--navy-900);line-height:1.3}
.c-sub{display:block;margin-top:3px;font-size:11.8px;color:var(--muted)}

/* The four-step strip. A step that has not happened must not look like one that
   has, so the difference is fill and colour, not a tick alone. */
.steps4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.step4{background:var(--paper);border:1px solid var(--line);border-radius:13px;
  padding:12px 14px;box-shadow:var(--sh-1,0 2px 10px rgba(11,30,49,.06))}
.step4 .s-n{display:block;font:800 9.4px/1 var(--sans);letter-spacing:.12em;
  text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.step4 b{display:flex;align-items:center;gap:6px;font-size:13.4px;color:var(--navy-800);
  font-weight:600;line-height:1.3}
.step4.done{background:#eaf6ee;border-color:#bfe0cc}
.step4.done .s-n{color:#2c7a53}
.step4.done b{color:#14603a}
.step4.done .ico{font-size:14px;color:var(--green)}
@media(max-width:900px){ .steps4{grid-template-columns:repeat(2,1fr)} }
@media(max-width:520px){ .steps4{grid-template-columns:1fr} }

/* Shortlist as a vertical list rather than a grid — the newer layout.
   Two lines per row: what it is and what it costs on the first, where it is on
   the second. `order` rather than a grid because the card's children are four
   different divs with no distinguishing hook between the two .sl-meta lines. */
.rows-list{display:grid;gap:12px}
.rows-list .sl{flex-direction:row;flex-wrap:wrap;align-items:center;
  gap:5px 16px;padding:14px 18px}
.rows-list .sl>.sl-flag{order:1;font-size:18px}
.rows-list .sl>h3{order:2;margin:0}
.rows-list .sl>.uni{order:3;margin:0;font-weight:600}
.rows-list .sl>.uni::before{content:"·";margin-right:11px;color:var(--muted);font-weight:400}
.rows-list .sl>.city{order:4;margin:0}
.rows-list .sl>.sl-tag{order:5;margin:0}
.rows-list .sl>.sl-meta{order:6;margin:0;white-space:nowrap}
.rows-list .sl>.sl-go{order:7;margin:0 0 0 auto;padding:0}
@media(max-width:760px){
  .rows-list .sl>.sl-go{margin-left:0;flex-basis:100%;padding-top:8px}
  .rows-list .sl>.uni::before{content:none}
}

/* Order summary rows: label left, figure right, on one baseline. */
.rc{display:flex;align-items:baseline;gap:12px;font-size:13px;color:var(--navy-800);
  padding:8px 0;border-bottom:1px solid var(--line)}
.rc:last-child{border-bottom:0}
.rc b{margin-left:auto;font-weight:700;color:var(--navy-900);white-space:nowrap}
.rc.sub{font-size:12.2px;color:var(--muted)}
.rc.sub b{font-weight:600;color:var(--muted)}

.p-cols-3{grid-template-columns:repeat(3,1fr)}
@media(max-width:1000px){ .p-cols-3{grid-template-columns:1fr} }

/* Status pills sit inside table cells here, where the column can be narrow
   enough to break "On the site" across two lines. They are labels, not prose. */
.tbl .st{white-space:nowrap;display:inline-block}
.tbl td{vertical-align:middle}

/* The 24-hour shortlist promise, counting down. Amber once it is close, because
   a countdown that looks the same at 20 hours and at 20 minutes is decoration. */
.sla{display:inline-flex;align-items:center;gap:6px;font:700 11px/1 var(--sans);
  padding:6px 10px;border-radius:999px;background:#eaf6ee;color:#14603a;border:1px solid #bfe0cc}
.sla.late{background:#fdf6e6;color:#8a6a1f;border-color:#e6d5a8}

/* ------------------------------------------------------------------ alerts */
/* The bell in the top bar. It is not decoration: the number on it is how many
   things are late, and it is on every staff screen because "everyone should be
   alerted" cannot mean "on the one screen they remembered to open". */
.bell{position:relative;display:grid;place-items:center;width:34px;height:34px;
  border-radius:10px;border:1px solid var(--line);background:#fff;cursor:pointer;
  color:var(--navy-700);margin-left:8px}
.bell:hover{background:#f4f7fb}
.bell .ico{width:17px;height:17px}
.bell-n{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;
  border-radius:999px;background:#c0392b;color:#fff;font:800 10.6px/18px var(--sans);
  text-align:center;box-shadow:0 0 0 2px #fff}
.bell-n.quiet{background:var(--navy-700)}
.bell-panel{position:fixed;top:58px;right:18px;z-index:300;width:min(430px,calc(100vw - 30px));
  max-height:min(72vh,640px);overflow-y:auto;background:#fff;border:1px solid var(--line);
  border-radius:14px;box-shadow:0 18px 44px rgba(11,30,49,.18);padding:6px}
.bell-panel h4{margin:0;padding:13px 14px 9px;font:700 12.4px/1 var(--sans);
  letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.al{display:block;width:100%;text-align:left;padding:11px 13px;border:0;border-radius:11px;
  background:none;cursor:pointer;border-bottom:1px solid var(--line)}
.al:last-child{border-bottom:0}
.al:hover{background:#f7f9fc}
.al b{display:block;font:700 13.1px/1.45 var(--sans);color:var(--navy-900);margin-bottom:3px}
.al span{display:block;font-size:12.2px;line-height:1.55;color:var(--muted)}
.al i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;
  vertical-align:1px;background:var(--navy-700)}
.al.now i{background:#c0392b}
.al.soon i{background:#c9821a}
.al.watch i{background:#7d8b9a}
.bell-empty{padding:26px 16px;text-align:center;color:var(--muted);font-size:12.9px;
  line-height:1.65}
.bell-who{display:flex;gap:8px;flex-wrap:wrap;padding:9px 13px 12px;border-bottom:1px solid var(--line)}
.bell-who span{font:600 11.8px/1.5 var(--sans);color:var(--navy-800);background:#f0f4f9;
  border-radius:999px;padding:3px 10px}
.bell-who span.hot{background:#fdecea;color:#7a2118}

/* ------------------------------------------------- what we still need from you */
.todo-card{background:#fdf6e6;border:1px solid #e6d5a8;border-radius:14px;
  padding:18px 20px;margin:0 0 20px}
.todo-head b{display:block;font:700 15.4px/1.35 var(--disp,inherit);color:#5b4409;
  margin-bottom:4px}
.todo-head span{display:block;font-size:12.9px;line-height:1.6;color:#7a5f13}
.todo-bar{height:7px;border-radius:5px;background:#efe0bc;margin:13px 0 12px;overflow:hidden}
.todo-bar i{display:block;height:100%;border-radius:5px;background:#c9821a}
.todo-card ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.todo-card li{font-size:13.1px;line-height:1.6;color:#5b4409}
.todo-card li b{color:#3f2f06}
.todo-card a{font-weight:700;color:#8a5a0b;text-decoration:underline;white-space:nowrap}

/* ------------------------------------------------------------- your orders */
.ord-card{background:var(--paper);border:1px solid var(--line);border-radius:14px;
  padding:16px 20px 14px;margin:0 0 20px}
.ord-h{display:block;font:700 12.6px/1 var(--sans);letter-spacing:.07em;
  text-transform:uppercase;color:var(--muted);margin-bottom:11px}
.ord-card ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.ord-card li{display:flex;gap:14px;align-items:center;flex-wrap:wrap;
  padding-bottom:10px;border-bottom:1px solid var(--line)}
.ord-card li:last-child{border-bottom:0;padding-bottom:0}
.ord-l{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}
.ord-l b{font:700 13.8px/1.4 var(--sans);color:var(--navy-900)}
.ord-l span{font-size:11.8px;color:var(--muted)}
.ord-r{display:flex;flex-direction:column;gap:2px;align-items:flex-end}
.ord-r b{font:700 13.8px/1.4 var(--sans);color:var(--navy-900)}
.ord-st{font:700 10.6px/1.7 var(--sans);letter-spacing:.05em;text-transform:uppercase;
  color:var(--muted)}
.ord-a{font:700 12.4px/1.5 var(--sans);color:var(--navy-700);text-decoration:underline;
  white-space:nowrap}

.ord-plan{flex-basis:100%;margin-top:10px;background:#f7f9fc;border:1px solid var(--line);
  border-radius:11px;padding:12px 14px}
.ord-plan > b{display:block;font:700 12.8px/1.4 var(--sans);color:var(--navy-900);
  margin-bottom:9px}
.ord-plan ul{display:grid;gap:7px;margin:0 0 10px;padding:0;list-style:none}
.ord-plan li{display:grid;grid-template-columns:1fr auto 84px;gap:12px;align-items:baseline;
  font-size:12.7px;color:var(--navy-800)}
.ord-plan li.done{color:var(--muted)}
.ord-plan li b{font-weight:700}
.ord-plan li i{font-style:normal;font-size:11.4px;color:var(--muted);text-align:right}
.ord-plan li.done i{color:#14603a}
@media (max-width:520px){ .ord-plan li{grid-template-columns:1fr auto} .ord-plan li i{display:none} }

/* ------------------------------------------------- conversations, overseen */
.convwho{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
/* A card here is a door, not a label: pressing one shows that counsellor's
   threads and nothing else. It was a plain div for months — a screen full of
   things that look pressable and are not teaches people to distrust the
   controls that do work. */
.cw{border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:#fff;
  width:100%;text-align:left;font:inherit;cursor:pointer;display:block;
  transition:border-color .13s, box-shadow .13s}
.cw:hover{border-color:var(--navy-600)}
.cw:focus-visible{outline:2px solid var(--blue,#1a4fb4);outline-offset:2px}
.cw[aria-pressed="true"]{border-color:var(--navy-800);
  box-shadow:inset 0 0 0 1px var(--navy-800)}
.cw.hot{border-color:#f0c8c4;background:#fdf6f5}
.cw.hot[aria-pressed="true"]{border-color:#b03a2e;box-shadow:inset 0 0 0 1px #b03a2e}
.cw b{display:block;font:700 13.2px/1.4 var(--sans);color:var(--navy-900)}
.cw span{display:block;font-size:11.8px;color:var(--muted);margin-top:2px}
.cw.hot span{color:#7a2118;font-weight:600}
.cw i{display:block;font-style:normal;font-size:11.2px;color:var(--muted);margin-top:4px}
/* Which slice is showing, and the way back out of it. */
.cwchip{margin-top:11px;font:600 12.2px/1.5 var(--sans);color:var(--navy-800)}
.cwchip .lnk{border:0;background:none;padding:0;font:inherit;color:var(--blue-deep);
  text-decoration:underline;cursor:pointer}
/* ---- deleting your own account ----
   Findable without being alarming. Red on the button that does it, not on the
   whole panel: a page that shouts before anybody has decided anything just
   teaches people to scroll past. */
.p-card.danger{border-color:#e8c9c4}
.p-card.danger h3{color:#a3302a;margin:0 0 10px}
.p-card.danger .d-say{margin:0 0 12px;font-size:13.6px;line-height:1.65;color:var(--muted);max-width:62ch}
.p-card.danger .d-say b{color:var(--navy-900)}
.p-card.danger .d-open{border-color:#e2b6b0;color:#a3302a}
.p-card.danger .d-open:hover{background:#fdf3f2;border-color:#c0392b}
.p-card.danger .d-go{background:#a3302a;border-color:#a3302a;color:#fff}
.p-card.danger .d-go:hover{background:#8c2721}
.p-card.danger .d-go:disabled{opacity:.6;cursor:default}
#delConfirm{margin-top:16px;padding-top:16px;border-top:1px solid var(--line);max-width:420px}

/* ---- the profile form's newer controls ---- */

/* Pick as many as apply. A <select multiple> needs a ctrl-click nobody knows
   about and is unusable on a phone, which is where these get filled in. */
.multi{display:flex;flex-wrap:wrap;gap:8px}
/* Prefixed with .field throughout. `.field label` sets uppercase, 11px, 800
   weight — meant for the caption above an input — and every one of these is a
   <label> inside a .field, so without the prefix the choices came out as
   shouting small-caps. `.field input` is worse: width:100%, height:54px and
   appearance:none turned each checkbox into a 44px rounded slab. */
.field .mchk{display:inline-flex;align-items:center;gap:9px;cursor:pointer;
  border:1.5px solid #d8dde4;border-radius:999px;padding:9px 15px;background:var(--paper);
  font:600 13.4px/1.2 var(--sans);letter-spacing:0;text-transform:none;
  color:var(--navy-800);margin:0;white-space:normal;transition:.13s}
.field .mchk:hover{border-color:var(--blue)}
.field .mchk input[type=checkbox]{width:16px;height:16px;min-width:16px;padding:0;
  margin:0;border-radius:4px;appearance:auto;-webkit-appearance:checkbox;
  accent-color:var(--blue-deep);background:none;border:0;box-shadow:none;flex:none}
.field .mchk.on{border-color:var(--blue-deep);background:#eef3fc;color:var(--navy-900)}

/* Day, month, year. Nothing typed, so nothing to correct. */
.d3{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:8px}
@media (max-width:420px){ .d3{grid-template-columns:1fr 1fr;} .d3 select:nth-child(2){grid-column:span 1} }

/* Two people, two blocks. Six fields in one column with only the label saying
   whose they are is how a manager's email lands under a professor's name. */
.fgrp{border:1.5px solid var(--line);border-left-width:4px;border-radius:12px;
  padding:14px 15px 4px;margin:0 0 15px}
.fgrp > b{display:flex;align-items:center;gap:10px;font:800 12.6px/1 var(--sans);
  margin-bottom:3px}
/* Change / Hide on a folded test. A link rather than a button in weight: it is
   a way back into the form, not an action on the record. */
.fgrp > b .grptog{margin-left:auto;appearance:none;border:0;background:none;
  cursor:pointer;font:700 11.4px/1 var(--sans);color:var(--blue-deep);
  text-decoration:underline;text-underline-offset:3px;padding:2px 0}
.fgrp > b .grptog:hover{color:var(--navy-900)}
.fgrp > b .grptog:focus-visible{outline:2px solid var(--blue,#1a4fb4);
  outline-offset:2px;border-radius:4px}
/* The one line a folded group shows: what was sat, and what was scored. */
.fgrp .grpsum{margin:7px 0 0;font:600 13.4px/1.5 var(--sans);color:var(--navy-900)}
.fgrp > span{display:block;font-size:11.8px;color:var(--muted);margin-bottom:13px;line-height:1.5}
.fgrp.blue{border-left-color:var(--blue-deep);background:#f6f9ff}
.fgrp.blue > b{color:var(--blue-deep)}
.fgrp.green{border-left-color:#166b40;background:#f4faf6}
.fgrp.green > b{color:#166b40}

/* Required, said on the label rather than only implied by the meter. */
.reqmark{margin-left:auto;font:800 9.2px/1 var(--sans);letter-spacing:.1em;
  text-transform:uppercase;color:#a3302a;background:#fdecea;border-radius:5px;padding:4px 6px}
.field.bad input,.field.bad select,.field.bad textarea{border-color:#c0392b;
  box-shadow:0 0 0 4px rgba(192,57,43,.13)}
.ferr{margin:6px 0 0;font:600 12px/1.5 var(--sans);color:#a3302a}

/* The cells that used to carry these as inline styles. Inline beats a
   stylesheet, so a white-space:nowrap written on the element could not be
   undone by the phone rules below — the classes exist so that it can. */
.cvsaid{max-width:330px}
.cvbal{font-size:12.4px;white-space:nowrap}
.cvact{white-space:nowrap}

/* ---- the conversations list on a phone ----
 *
 * Six columns is 1,180px, and the box holding it is 356px on a 390px screen.
 * Patch 68 moved the link that opens a thread onto the student's name so that
 * the row was usable at all; Waiting and Balance were still behind a sideways
 * scroll nobody would think to try.
 *
 * A row becomes a card. The header row goes — a two-word label in front of
 * each value says the same thing and travels with it. */
@media (max-width:600px){
  .cvtbl thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);
    clip-path:inset(50%);white-space:nowrap}
  .cvtbl, .cvtbl tbody, .cvtbl tr, .cvtbl td{display:block;width:auto}
  /* `.p-card > .tbl{min-width:1180px}` is what makes a six-column table
     scroll rather than crush itself, and it was still holding this one open at
     1,180px after every cell had become a block. Three classes deep so it wins
     wherever the two rules end up sitting relative to each other. */
  .p-card > .cvtbl.tbl{min-width:0}
  .cvtbl tr{border:1px solid var(--line);border-radius:12px;background:var(--paper);
    padding:12px 13px;margin:0 0 10px}
  .cvtbl tr.late{border-color:#f0c8c4;background:#fdf6f5}
  /* The desktop rule paints urgency as a bar down the first cell, which in a
     card is a stripe across the top of the name. The whole card says it. */
  .cvtbl tr.late td:first-child{box-shadow:none}
  .cvtbl td{border:0;padding:5px 0}
  .cvtbl td[data-lb]::before{content:attr(data-lb);display:block;
    font:800 9.4px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;
    color:var(--muted);margin-bottom:4px}
  .cvtbl .cvname{padding-top:0}
  .cvtbl .cvname b{font-size:15px}
  .cvsaid{max-width:none}
  .cvbal{white-space:normal}
  .cvact{white-space:normal;display:flex;gap:8px;padding-top:10px}
  .cvact .btn{flex:1 1 auto;justify-content:center}
  .cvtbl .cvwho select{width:100%}
  /* One card with the empty-state sentence in it, not a card per column. */
  .cvtbl td[colspan]{padding:14px 0}
}

/* The student's name, which is the control that opens the thread. */
.cvopen{text-decoration:none;color:inherit}
.cvopen b{text-decoration:underline;text-underline-offset:2px;
  text-decoration-color:var(--line)}
.cvopen:hover b{color:var(--blue-deep);text-decoration-color:currentColor}
tr.late td:first-child{box-shadow:inset 3px 0 0 #c0392b}

/* An administrator's word to the counsellor. It sits above the thread on the
   student's file, where the conversation it is about is. */
.guide{background:#fdf6e6;border:1px solid #e6d5a8;border-radius:12px;
  padding:13px 15px;margin:0 0 13px}
.guide b{display:block;font:700 11.6px/1.5 var(--sans);letter-spacing:.05em;
  text-transform:uppercase;color:#8a5a0b;margin-bottom:4px}
.guide p{margin:0;font-size:13.2px;line-height:1.65;color:#5b4409}
.guide small{display:block;margin-top:7px;font-size:11.2px;color:#8a5a0b}

/* ---- long lists, one page at a time ---- */
.pgr{display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:11px 14px;border-top:1px solid var(--line);background:var(--paper)}
.pgr .pgn{font:600 12.2px/1.4 var(--sans);color:var(--muted)}
.pgr .pgg{font-size:12.2px;color:var(--muted);padding:0 2px}
.pgb{appearance:none;cursor:pointer;background:#fff;border:1.5px solid #d8dde4;
  border-radius:8px;padding:6px 10px;font:600 12.2px/1.2 var(--sans);
  color:var(--navy-800);transition:border-color .12s, background .12s}
.pgb:hover:not(:disabled){border-color:var(--navy-600);background:var(--paper)}
.pgb:focus-visible{outline:2px solid var(--blue,#1a4fb4);outline-offset:2px}
.pgb.on{background:var(--navy-900);border-color:var(--navy-900);color:#fff}
.pgb:disabled{opacity:.42;cursor:default}
@media (max-width:560px){ .pgr .pgn{width:100%} }

/* ---- the office tabs ---- */
/* Four full tables stacked on one page is thirty-four screens of scrolling at
   131 students. One at a time, and the page is one screen again. */
.otabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;
  border-bottom:1.5px solid var(--line);padding-bottom:0}
.otab{appearance:none;cursor:pointer;background:none;border:none;
  border-bottom:2.5px solid transparent;margin-bottom:-1.5px;
  padding:9px 13px;font:700 13.4px/1.4 var(--sans);color:var(--muted);
  display:flex;align-items:center;gap:7px}
.otab:hover{color:var(--navy-800)}
.otab[aria-selected="true"]{color:var(--navy-900);border-bottom-color:var(--navy-900)}
.otab:focus-visible{outline:2px solid var(--blue,#1a4fb4);outline-offset:2px}
.otab .n{font:700 11.4px/1 var(--sans);background:var(--paper);
  border:1px solid var(--line);border-radius:999px;padding:3px 7px;color:var(--navy-800)}
.otab[aria-selected="true"] .n{background:var(--navy-900);border-color:var(--navy-900);color:#fff}
.opane{display:none}
.opane.active{display:block}

/* A package name is a phrase, not a word, and the chip was sized as though it
   were one — so "Academic CV & Resume" broke out of its own background and
   printed over the row above it. */
/* A package name is a phrase — "Academic CV & Resume" — and the chip was sized
   as though it were a word, so it broke out of its own background and printed
   over the row above. Only the ones that carry a phrase are allowed to wrap:
   letting the short status pills wrap too turned "Private" into "Privat / e"
   and "On the site" into three lines, which is worse than what it fixed. */
.tbl .sl-chip, .tbl .chip{display:inline-block;max-width:100%;
  white-space:normal;overflow-wrap:anywhere;line-height:1.45;vertical-align:top}
.tbl .st{white-space:nowrap}
/* And a row is read across, so its cells line up at the top rather than
   floating in the middle of whatever the tallest one turned out to be. */
.tbl td{vertical-align:top}

/* A wide table scrolls sideways INSIDE its card rather than squeezing every
   column until the words break. Without a floor the browser keeps shrinking
   cells to fit and there is nothing to scroll, which is how a screen ends up
   with no scrollbar and no readable columns either. */
.p-card > .tbl{min-width:1180px}

/* And the scrolling has to be VISIBLE. macOS hides scrollbars until something
   moves, so a table that continues past the edge looks like a table that has
   been cut off — which is exactly what it was reported as. Three things say
   otherwise: a scrollbar that is always drawn, a shadow on whichever edge has
   more behind it, and a line of text under the table saying so. */
.scrollx{overflow-x:auto;scrollbar-width:thin;scrollbar-color:#c6ccd6 #eef1f5}
.scrollx::-webkit-scrollbar{height:11px;-webkit-appearance:none}
.scrollx::-webkit-scrollbar-thumb{background:#c6ccd6;border-radius:99px;
  border:2px solid #eef1f5}
.scrollx::-webkit-scrollbar-thumb:hover{background:#9aa3b2}
.scrollx::-webkit-scrollbar-track{background:#eef1f5;border-radius:99px}

.scrollwrap{position:relative}
.scrollwrap::before,.scrollwrap::after{content:'';position:absolute;top:0;bottom:0;
  width:26px;pointer-events:none;opacity:0;transition:opacity .16s;z-index:2}
.scrollwrap::before{left:0;background:linear-gradient(90deg,rgba(11,30,49,.13),transparent)}
.scrollwrap::after{right:0;background:linear-gradient(270deg,rgba(11,30,49,.13),transparent)}
.scrollwrap.more-left::before{opacity:1}
.scrollwrap.more-right::after{opacity:1}

.scrollsay{margin:0;padding:8px 14px;border-top:1px solid var(--line);
  font:600 11.8px/1.4 var(--sans);color:var(--muted);background:var(--paper)}

/* ------------------------------------------ who is doing this one ------- */
/*
 * The control that hands a piece of work to somebody, wherever it appears.
 *
 * It was first written as an inline style on one table, at the size a table
 * cell wants to be — twelve-point text in a hundred-and-fifty-pixel box. That
 * is fine for a column somebody reads and wrong for the control they came to
 * the screen to USE, which is what this became once it appeared on the orders,
 * the conversations and the leads book as well. It is the same size as a
 * button now, wide enough for a full name without cutting it off, and it
 * carries the arrow so it reads as something that opens rather than as a
 * bordered label.
 */
select.assign{appearance:none;-webkit-appearance:none;width:100%;min-width:186px;
  max-width:230px;padding:11px 34px 11px 13px;border-radius:10px;
  font:600 13.4px/1.25 var(--sans);color:var(--navy-900);cursor:pointer;
  border:1.5px solid #d3d9e2;background-color:var(--paper);
  background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%234a5568' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6.5 8 10.5 12 6.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 11px center;
  background-size:15px 15px;transition:border-color .12s, box-shadow .12s}
select.assign:hover{border-color:var(--navy-600)}
select.assign:focus-visible{outline:none;border-color:var(--navy-700);
  box-shadow:0 0 0 3px rgba(26,79,180,.16)}

/* Nobody is doing it. This is the state the screen exists to make obvious, so
   it is not a pale pink hint — it is the loudest thing in the row. */
select.assign.none{border-color:#c9453a;border-width:2px;color:#a5342b;
  background-color:#fdf1ef;
  background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23a5342b' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6.5 8 10.5 12 6.5'/%3E%3C/svg%3E")}
select.assign.none:hover{border-color:#a5342b}

/* On a phone the table scrolls sideways and a 230px control inside a cell is
   what makes it scroll. It stands down rather than setting the floor. */
@media (max-width:560px){
  select.assign{min-width:150px;padding:9px 30px 9px 11px;font-size:12.6px}
}
"""
