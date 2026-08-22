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
"""
