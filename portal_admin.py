"""The admin screen — the organisation, and who is looking after whom."""

BODY = """
    <style>
      /* Counter tiles. The column count was an inline style on every one of
         these, which beats any media query — so a row of four or five tiles
         pushed the page sideways on a phone. The count is a custom property
         now, and the row folds to two, then one, as the screen narrows. */
      .out.tiles{grid-template-columns:repeat(var(--tiles,4),1fr)}
      @media (max-width:820px){ .out.tiles{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:430px){ .out.tiles{grid-template-columns:1fr} }
    </style>

    <!-- Every count leads somewhere. Three filter the table below, Enquiries
         opens the enquiry book, and Orders placed scrolls to the order book —
         which did not exist, which is why this one used to be a plain number. -->
    <div class="out tiles" style="--tiles:5;margin:0 0 20px">
      <button type="button" class="outgo" data-go="all">
        <b id="kStudents">—</b><span>Students</span></button>
      <button type="button" class="outgo" data-go="unassigned">
        <b id="kUnassigned">—</b><span>Unassigned</span></button>
      <button type="button" class="outgo" data-go="docs">
        <b id="kDocs">—</b><span>Docs to review</span></button>
      <button type="button" class="outgo" data-go="enquiries">
        <b id="kEnq">—</b><span>Enquiries</span></button>
      <button type="button" class="outgo" data-go="orders">
        <b id="kRev">—</b><span>Orders placed</span></button>
    </div>

    <style>
      .out .outgo{appearance:none;font:inherit;text-align:center;cursor:pointer;
        transition:border-color .12s, background .12s, transform .12s}
      .out .outgo:hover{border-color:var(--navy-600);background:var(--paper);
        transform:translateY(-1px)}
      .out .outgo:focus-visible{outline:2px solid var(--blue,#1a4fb4);outline-offset:2px}
      .out .outgo span{text-decoration:underline;text-decoration-color:transparent;
        text-underline-offset:3px;transition:text-decoration-color .12s}
      .out .outgo:hover span{text-decoration-color:currentColor}
      .out .outgo.on{border-color:var(--navy-700);background:var(--paper);
        box-shadow:inset 0 0 0 1px var(--navy-700)}
      .out .outgo.on span{text-decoration-color:currentColor}
    </style>

    <div class="p-cols" style="margin-bottom:20px;align-items:start">
      <div class="p-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">
          <h3 style="margin:0">The team</h3>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-primary btn-sm" id="addPerson">+ Add someone</button>
        </div>
        <ul class="doclist" id="counsellors" style="margin-top:12px"></ul>
        <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">A counsellor
          can open a student's profile, documents and conversation only once that student is
          assigned to them. The rule is enforced on the server, not by hiding a row.</p>
      </div>
      <div class="p-card">
        <h3>Channels</h3>
        <ul class="doclist" id="channels"></ul>
        <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">Email falls
          back to writing <code>.eml</code> files into <code>data/outbox/</code> until
          <code>mail.env</code> has a password in it. WhatsApp needs a Meta Business account and a
          public HTTPS webhook — the messenger works without it.</p>
      </div>
    </div>

    <div class="modal" id="personModal" role="dialog" aria-modal="true">
      <div class="sheet" style="width:min(520px,100%)">
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <h3 id="pTitle">Add someone to the team</h3>
        <p class="lead">They can sign in straight away with the password this creates.</p>
        <div id="pForm">
          <div class="field" style="margin-bottom:10px"><label for="pName">Their name</label>
            <input id="pName" placeholder="Kavya Reddy"></div>
          <div class="field" style="margin-bottom:10px"><label for="pEmail">Work email</label>
            <input id="pEmail" placeholder="kavya@glovels.com" inputmode="email"></div>
          <div class="field" style="margin-bottom:10px"><label for="pPhone">Mobile (optional)</label>
            <input id="pPhone" inputmode="tel" placeholder="98765 43210"></div>
          <div class="field" style="margin-bottom:10px"><label for="pRole">What kind of account</label>
            <select id="pRole">
              <option value="counsellor">Counsellor — their own students, and the chat</option>
              <option value="editor">Website editor — the site only, no student records</option>
              <option value="admin">Administrator — everything, including this screen</option>
              <option value="student">Student — a real student account on this site</option>
              <option value="partner">Partner agency — a B2B partner who sends us students</option>
            </select></div>
          <p id="pPartnerNote" style="display:none;margin:0 0 10px;padding:11px 13px;
            border-radius:10px;background:#f6f2ea;border:1px solid #e2d6bd;
            font:600 12.4px/1.55 var(--sans);color:var(--navy-800)">
            A partner agency signs in to one screen: the students it has sent us, and a
            way to add more. It cannot see another agency's students, your leads, your
            money or anything under Organisation. Students it adds arrive
            <b>unassigned</b>, for you to hand to a counsellor.</p>
          <p id="pStudentNote" style="display:none;margin:0 0 10px;padding:11px 13px;
            border-radius:10px;background:#f1f6fb;border:1px solid #cfe0f2;
            font:600 12.4px/1.55 var(--sans);color:var(--navy-800)">
            A real student account &mdash; their own dashboard, shortlist, documents and
            messages. Give them the password below and they can change it themselves. Use this
            for a walk-in, or to make yourself a test login. A counsellor creating one keeps it;
            one you create as an administrator is left unassigned, so somebody picks it up from
            the Unassigned counter above.</p>
          <div id="pPermBox" style="padding:12px 14px;border-radius:11px;background:var(--paper);
            border:1px solid var(--line,#e6e9ee);margin-bottom:4px">
            <span style="display:block;font:800 10.4px/1 var(--sans);letter-spacing:.12em;
              text-transform:uppercase;color:var(--muted);margin-bottom:9px">What they may change
              on the website</span>
            <label style="display:flex;gap:8px;align-items:flex-start;font:600 12.8px/1.45
              var(--sans);color:var(--navy-800);margin-bottom:8px">
              <input type="checkbox" id="pPermContent" style="margin-top:2px">
              <span>The home page &mdash; packages, prices, the figures, the questions, the
                stories and the wording</span></label>
            <label style="display:flex;gap:8px;align-items:flex-start;font:600 12.8px/1.45
              var(--sans);color:var(--navy-800)">
              <input type="checkbox" id="pPermCatalogue" style="margin-top:2px">
              <span>Universities and destinations &mdash; adding, editing and removing what the
                finder offers</span></label>
          </div>
          <p style="margin:8px 0 0;font-size:11.8px;color:var(--muted);line-height:1.55">
            A password is generated and shown once, on the next screen. It is stored hashed, so
            nobody &mdash; including you &mdash; can read it back afterwards. If it is lost, use
            <b>Reset password</b> beside their name.</p>
        </div>
        <div id="pDone" style="display:none"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap" id="pButtons">
          <button type="button" class="btn btn-primary" id="pSave">Create the account</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        </div>
        <p id="pErr" role="alert" style="display:none;margin:14px 0 0;padding:11px 13px;
          border-radius:10px;font:600 12.8px/1.5 var(--sans);background:#fdf3f2;
          border:1px solid #f0c8c4;color:#7a2118"></p>
      </div>
    </div>

    <!-- Four full tables on one page was thirty-four screens of scrolling at a
         hundred and thirty students, and the fourth one may as well not have
         existed. One at a time, with the true count on each tab. -->
    <div class="otabs" role="tablist">
      <button class="otab" role="tab" data-o="students" aria-selected="true">
        Every student <span class="n">0</span></button>
      <button class="otab" role="tab" data-o="orders" aria-selected="false">
        Orders <span class="n">0</span></button>
      <button class="otab" role="tab" data-o="money" aria-selected="false">
        Money</button>
      <button class="otab" role="tab" data-o="email" aria-selected="false">
        Email</button>
      <button class="otab" role="tab" data-o="chats" aria-selected="false">
        Conversations <span class="n">0</span></button>
    </div>

    <div class="opane active" id="o-students">
    <div class="p-sec">
      <div class="p-sec-head"><h2 id="everyStudent">Every student</h2>
        <span id="onlyChip" hidden class="st wait" style="text-transform:none;letter-spacing:0;
          cursor:pointer" title="Show everybody again"></span>
        <input id="findStudent" placeholder="Search" style="margin-left:auto;padding:8px 11px;
          font:400 12.8px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;min-width:220px"></div>
      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Student</th><th>Package</th><th>Shortlist</th><th>Documents</th>
            <th>Counsellor</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <div id="stuPager"></div>
      </div>
    </div>

    <!-- Every order, including the ones placed before the buyer made an account.
         There was nowhere at all to see these: the screen counted them, showed a
         rupee total and stopped. Somebody who had just bought four services
         could not find one of them. -->
    </div><!-- /o-students -->

    <div class="opane" id="o-orders">
    <div class="p-sec">
      <div class="p-sec-head"><h2 id="everyOrder">Orders</h2>
        <span id="ordGuests" hidden class="st wait" style="text-transform:none;
          letter-spacing:0"></span>
        <!-- Somebody has paid and nobody is dealing with them. This is the one
             thing on the order book worth interrupting a morning for, so it is
             a button that shows exactly those rows rather than a colour on a
             cell you have to go looking for. -->
        <button type="button" id="ordNone" hidden class="st bad"
          style="border:0;cursor:pointer;text-transform:none;letter-spacing:0;
          font:700 12.4px/1.4 var(--sans)"></button>
        <input id="findOrder" placeholder="Reference, name or email"
          style="margin-left:auto;padding:8px 11px;font:400 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px;min-width:220px"></div>
      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Reference</th><th>Who</th><th>What they bought</th>
            <th style="text-align:right">Amount</th><th>Account</th><th>Counsellor</th>
            <th>When</th></tr></thead>
          <tbody id="ordRows"></tbody>
        </table>
        <div id="ordPager"></div>
      </div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        An order placed before somebody signs up shows as <b>no account yet</b>. It attaches
        itself the moment they register with the same email &mdash; nothing is lost, but until
        then there is nobody to call it up on a dashboard, so those are the ones to chase.
        No money moves on this site yet: an amount here is what was agreed, not what was
        collected.</p>
    </div>

    <!-- The money.
         Four numbers, and then who to ring about them. A total nobody can act
         on is a total nobody looks at twice. -->
    </div><!-- /o-orders -->

    <div class="opane" id="o-money">
    <div class="p-sec" id="theMoney">
      <div class="p-sec-head"><h2>Money</h2>
        <span id="moneyLate" hidden class="st bad"
          style="text-transform:none;letter-spacing:0"></span>
      </div>

      <div class="out tiles" style="--tiles:4;margin:0 0 16px">
        <div><b id="mExpected">—</b><span>Agreed</span></div>
        <div><b id="mReceived">—</b><span>Received</span></div>
        <div><b id="mPending">—</b><span>Still to collect</span></div>
        <div><b id="mLost">—</b><span>Lost to drop-off</span></div>
      </div>

      <div class="p-cols" style="align-items:start;margin-bottom:16px">
        <div class="p-card">
          <h3 style="margin:0 0 9px;font-size:15px">Who to ring</h3>
          <div style="overflow-x:auto">
            <table class="tbl" style="margin:0">
              <thead><tr><th>Student</th><th>Package</th><th>Outstanding</th>
                <th>Overdue</th><th>Since</th><th></th></tr></thead>
              <tbody id="owingRows"></tbody>
            </table>
            <div id="owingPager"></div>
          </div>
        </div>
        <div class="p-card">
          <h3 style="margin:0 0 9px;font-size:15px">The rest of it</h3>
          <ul class="doclist" id="moneyMore" style="margin:0"></ul>
          <p style="margin:12px 0 0;font-size:12px;color:var(--muted);line-height:1.6">
            Prices include GST, so the tax is inside <b>Received</b> rather than on top of
            it &mdash; and it is worked out from money that actually arrived, never from
            what was invoiced. Commissions from Expatrio, universities and loan referrals
            are not counted here.</p>
        </div>
      </div>


    </div>

    <!-- Every conversation, and how long it has been waiting.
         An administrator could already open any student's file — one at a time,
         having first guessed which one to open. That is not oversight. -->
    </div><!-- /o-money -->

    <div class="opane" id="o-email">
      <div class="p-sec">
        <div class="p-sec-head"><h2>Email</h2></div>
        <!-- Is the email actually going out?
           There was no way to ask this from inside the site. The mailer said
           what it was doing in one line of the server's start-up log and
           nowhere else, and because mail is never allowed to fail a request,
           an undelivered password reset looks exactly like a delivered one. -->
      <div class="p-card" id="mailCard" style="margin-bottom:16px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <h3 style="margin:0;font-size:15px">Email</h3>
          <span class="st" id="mailMode">checking…</span>
          <span style="flex:1"></span>
          <input id="mailTo" placeholder="send a test to… (blank = you)"
            style="width:230px;padding:7px 10px;font:400 12.6px/1.3 var(--sans);
            border:1.5px solid #d8dde4;border-radius:8px">
          <button type="button" class="btn btn-ghost btn-sm" id="mailTest">
            Send a test email</button>
        </div>
        <p id="mailSays" style="margin:10px 0 0;font-size:12.6px;line-height:1.65;
          color:var(--navy-800)"></p>
        <ul class="doclist" id="mailMore" style="margin:10px 0 0"></ul>

        <!-- The settings themselves. A mail setting that can only be changed in
             a hosting dashboard, behind a redeploy, is one nobody in the office
             can fix. -->
        <details id="mailEdit" style="margin-top:12px">
          <summary style="cursor:pointer;font:700 12.8px/1.5 var(--sans);
            color:var(--navy-900)">Change these settings</summary>
          <!-- The way that works on a host which blocks SMTP, which this one
               does: Render's free plan blocks ports 25, 465 and 587. -->
          <div class="two" style="margin-top:10px">
            <div class="field"><label for="mProvider">Send over HTTPS with</label>
              <select id="mProvider"></select></div>
            <div class="field"><label for="mKey">API key</label>
              <input id="mKey" type="password" autocomplete="off"
                placeholder="paste the provider's key"></div>
          </div>
          <p style="margin:-2px 0 12px;font-size:11.8px;color:var(--muted);line-height:1.6">
            Pick a provider and the mail goes out over the web on port 443, which no
            host blocks &mdash; the four boxes below are then not used at all. Leave it
            on <b>a mail server (SMTP)</b> to use them instead.</p>
          <div class="two">
            <div class="field"><label for="mHost">Outgoing server</label>
              <input id="mHost" placeholder="mailout.one.com"></div>
            <div class="field"><label for="mPort">Port</label>
              <input id="mPort" inputmode="numeric" placeholder="587"></div>
          </div>
          <div class="two">
            <div class="field"><label for="mUser">Username</label>
              <input id="mUser" placeholder="info@glovels.com"></div>
            <div class="field"><label for="mPass">Password</label>
              <input id="mPass" type="password" autocomplete="new-password"
                placeholder="leave empty to keep the one saved"></div>
          </div>
          <div class="two">
            <div class="field"><label for="mFrom">Send as</label>
              <input id="mFrom" placeholder="Glovels &lt;info@glovels.com&gt;"></div>
            <div class="field"><label for="mOffice">Office inbox</label>
              <input id="mOffice" placeholder="info@glovels.com"></div>
          </div>
          <p style="margin:0 0 10px;font-size:11.8px;color:var(--muted);line-height:1.6">
            Saved on your server and in force immediately — no redeploy. The password
            is never shown again once saved; leave the box empty to keep it. What you
            save here overrides anything set in the hosting environment.</p>
          <button type="button" class="btn btn-primary btn-sm" id="mailSave">
            Save and use these</button>
        </details>
      </div>
      </div>
    </div><!-- /o-email -->

    <div class="opane" id="o-chats">
    <div class="p-sec" id="everyChat">
      <div class="p-sec-head"><h2>Conversations</h2>
        <span id="chatLate" hidden class="st bad" style="text-transform:none;
          letter-spacing:0"></span>
        <label style="margin-left:auto;display:flex;gap:7px;align-items:center;
          font:600 12.4px/1.4 var(--sans);color:var(--navy-800)">
          <input type="checkbox" id="onlyWaiting"> Only ones waiting on us</label>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <b style="display:block;font:700 12.4px/1 var(--sans);letter-spacing:.07em;
          text-transform:uppercase;color:var(--muted);margin-bottom:11px">By counsellor</b>
        <div class="convwho" id="convWho"></div>
        <div class="cwchip" id="convChip" hidden></div>
      </div>

      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Student</th><th>Counsellor</th><th>Last said</th>
            <th>Waiting</th><th>Balance</th><th></th></tr></thead>
          <tbody id="convRows"></tbody>
        </table>
        <div id="convPager"></div>
      </div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        <b>Waiting</b> is how long since the student wrote and nobody answered. A thread where
        we spoke last is not waiting on anybody, whatever its age. <b>Balance</b> is how many
        messages each side has sent &mdash; nine from them and one from us is not a
        conversation. <b>Guide</b> writes a note to the counsellor about this student that the
        student never sees.
      </p>
    </div>
    </div><!-- /o-chats -->
"""

SCRIPT = r"""
let STUDENTS = [], COUNSELLORS = [], PEOPLE = [], ME = 0, filter = '';

/* The two things an account can be trusted with beyond its own students. */
const PERMS = [['content', 'Home page'], ['catalogue', 'Universities']];

const inr = p => '₹' + Number(p / 100).toLocaleString('en-IN');

/*
 * The one control that hands a student to somebody, wherever the work is being
 * looked at.
 *
 * It used to exist on the student list alone, which is not where anybody is
 * standing when they decide who should deal with something. Work arrives as an
 * order, as an enquiry or as a message, and each of those screens showed the
 * counsellor's name as text — so the answer to "who is doing this one" was
 * readable and unchangeable at the same time. This returns the select, and
 * every table that knows a student id can drop it into a cell.
 *
 * Everything routes through the student, because that is what the server
 * stores: there is no such thing as the counsellor for an order. Assigning
 * from the order book assigns the person who placed it, which is what somebody
 * looking at that row means.
 */
function assignCell(studentId, currentId) {
  if (!studentId) return '';
  const has = currentId != null && currentId !== '';
  const opts = ['<option value="">— nobody yet —</option>'].concat(
    COUNSELLORS.map(c => '<option value="' + c.id + '"' +
      (String(c.id) === String(currentId) ? ' selected' : '') + '>' + esc(c.name) + '</option>')
  ).join('');
  return '<select class="assign' + (has ? '' : ' none') + '" data-assign="' + studentId +
    '">' + opts + '</select>';
}

function row(s) {
  return '<tr data-row="' + s.id + '">' +
    '<td><b>' + esc(s.name) + '</b><br><span style="font-size:11.8px;color:var(--muted)">' +
      esc(s.email) + '</span></td>' +
    '<td>' + (s.package ? '<span class="sl-chip">' + esc(s.package) + '</span>'
                        : '<span style="color:var(--muted);font-size:12.4px">—</span>') + '</td>' +
    '<td>' + s.shortlist + '</td>' +
    '<td>' + s.docsVerified + '/' + s.docsTotal +
      (s.docsWaiting ? ' <span class="st wait" style="margin-left:5px">' + s.docsWaiting + ' waiting</span>' : '') + '</td>' +
    '<td>' + assignCell(s.id, s.counsellor ? s.counsellor.id : null) + '</td>' +
    '<td style="white-space:nowrap"><a class="btn btn-ghost btn-sm" href="counsellor.html?student=' + s.id + '">Open' +
      (s.unread ? ' <span class="st wait" style="margin-left:5px">' + s.unread + '</span>' : '') + '</a>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-invite="' + s.id +
        '" style="margin-left:6px" title="Email them a link to set their password">' +
        'Send sign-in link</button>' +
      /* The link is the polite route and needs a working inbox. This is the one
         for the student on the phone saying they cannot get in — the office
         reads them the new password and they choose their own on the way in.
         The endpoint has existed all along; it was only reachable from the
         staff list, which does not contain students. */
      '<button type="button" class="btn btn-ghost btn-sm" data-pwreset="' + s.id +
        '" style="margin-left:6px" title="Generate a new password and read it to them">' +
        'Reset password</button>' +
      /* How a file ends. Two endings, and they are not the same: completed
         means the work was delivered, left means they stopped part-way and
         what is still owed becomes lost rather than pending. Nothing else in
         the application can tell those apart, so if this control does not
         exist the money screen cannot be honest. */
      '<select data-close="' + s.id + '" style="margin-left:6px;padding:6px 9px;' +
        'font:600 12.2px/1.3 var(--sans);border:1.5px solid ' +
        (s.status === 'left' ? '#e0b4ae' : s.status === 'completed' ? '#c8e3d0' : '#d8dde4') +
        ';border-radius:8px;background:' +
        (s.status === 'left' ? '#fdf3f2' : s.status === 'completed' ? '#f1f8f3' : 'var(--paper)') +
        '">' +
        [['active', 'On the books'], ['completed', 'Completed \u2014 close'],
         ['left', 'Left part-way \u2014 close']]
          .map(function (r) {
            return '<option value="' + r[0] + '"' +
              ((s.status || 'active') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
          }).join('') +
      '</select></td>' +
    '</tr>';
}

/* Which subset the counters asked for: '' (everybody), 'unassigned', 'docs'. */
let only = '';

function paint() {
  const q = filter.toLowerCase();
  const list = STUDENTS
    .filter(s => only !== 'unassigned' || !s.counsellor)
    .filter(s => only !== 'docs' || s.docsWaiting > 0)
    .filter(s => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));

  const chip = $('#onlyChip');
  chip.hidden = !only;
  chip.textContent = only === 'unassigned' ? 'Unassigned only \u00d7'
    : only === 'docs' ? 'Waiting on documents \u00d7' : '';

  /* Which view you are in, marked on the counter that chose it. Without this the
     screen gives no clue that the list is filtered once the chip has scrolled out
     of sight, and pressing Students while already unfiltered looks like a button
     that does nothing. */
  $$('[data-go]').forEach(el =>
    el.classList.toggle('on', el.dataset.go === (only || 'all')));

  $('#rows').innerHTML = paged('stu', list).map(row).join('') ||
    '<tr><td colspan="6" style="color:var(--muted);padding:22px">' +
    (only === 'unassigned' ? 'Everybody has a counsellor.'
      : only === 'docs' ? 'No documents are waiting for review.'
      : 'Nobody matches that search.') + '</td></tr>';
  /* The count under the table is of the WHOLE filtered list, not of what is on
     screen. A table that shows twenty-five and says twenty-five is how a cap
     hides. */
  $('#stuPager').innerHTML = pagerHtml('stu', list.length, 'students', paint);
  const tab = $('.otab[data-o="students"] .n');
  if (tab) tab.textContent = list.length;
}

/* The counters are shortcuts into this table, or out to another screen. A
   number nobody can click through to is a dead end — which is exactly what the
   first person to use this screen said about it. */
document.addEventListener('click', e => {
  const chip = e.target.closest('#onlyChip');
  if (chip) { only = ''; paint(); return; }

  const go = e.target.closest('[data-go]');
  if (!go) return;
  const what = go.dataset.go;

  /* The enquiry book moved: every lead, from every source, is in one place. */
  if (what === 'enquiries') { location.href = 'leads.html'; return; }
  /* These used to scroll. Now they open the tab the number lives on, which is
     the same promise kept with less travelling. */
  if (what === 'orders') { showTab('orders'); return; }

  only = what === 'all' ? '' : what;
  filter = '';
  $('#findStudent').value = '';
  /* A counter that filters the student table has to put you on the student
     table, or it filters something you cannot see. */
  showTab('students');
  PAGE_AT.stu = 0;
  paint();
});

/* ------------------------------------------------------------------- tabs */
function showTab(which) {
  $$('.otab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.o === which)));
  $$('.opane').forEach(pn => pn.classList.toggle('active', pn.id === 'o-' + which));
  /* Where the tab bar is, not where the page happens to be scrolled. Switching
     tab and landing half way down the new one reads as a broken click. */
  const bar = $('.otabs');
  if (bar && bar.getBoundingClientRect().top < 0) {
    bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  try { sessionStorage.setItem('gv-admin-tab', which); } catch (e) {}
}
document.addEventListener('click', e => {
  const t = e.target.closest('.otab');
  if (t) showTab(t.dataset.o);
});
/* A link that points at something on this screen opens the tab it is on.
   `admin.html#theMoney` used to scroll; a section inside a closed pane cannot
   be scrolled to, so it would have done nothing at all. */
const TAB_OF = { everyStudent: 'students', everyOrder: 'orders',
  theMoney: 'money', mailCard: 'email', everyChat: 'chats' };
function tabForHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return '';
  if ($('#o-' + h)) return h;                       // #students, #money…
  if (TAB_OF[h]) return TAB_OF[h];
  const el = document.getElementById(h);
  const pane = el && el.closest('.opane');
  return pane ? pane.id.replace(/^o-/, '') : '';
}
addEventListener('hashchange', () => {
  const t = tabForHash();
  if (t) showTab(t);
});

/* Reopened on the tab they left — unless a link said otherwise. An
   administrator assigning counsellors down a long list, who clicks into a file
   and comes back, should not have to find their way back to it. */
try {
  const asked = tabForHash();
  const back = asked || sessionStorage.getItem('gv-admin-tab');
  if (back && $('#o-' + back)) showTab(back);
} catch (e) {}

/* --------------------------------------------------- sending a student their way in */

/*
 * A link, not a password.
 *
 * The office could make an account and read its password off one screen, then
 * had to get it to the student somehow. This emails a set-password link — and
 * because email does not leave the building until SMTP is configured, it also
 * puts the link on screen to be copied into WhatsApp. Saying "sent" while the
 * message sits in a folder is a lie the office would only discover when a
 * student says they never got it.
 */
async function sendInvite(id, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending\u2026';
  try {
    const r = await api('POST', '/api/staff/students/' + id + '/invite');
    const row = btn.closest('tr');
    const cell = row.querySelector('td');
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:7px;padding:9px 11px;border-radius:9px;font:600 11.8px/1.5 '
      + 'var(--sans);background:' + (r.sent ? '#eef8f2' : '#fbf1da') + ';border:1px solid '
      + (r.sent ? '#bfe0cc' : '#e6d5a8') + ';color:' + (r.sent ? '#14603a' : '#7a4f08')
      + ';white-space:normal;max-width:340px';
    note.innerHTML = r.sent
      ? 'Emailed to <b>' + esc(r.email) + '</b>. The link lasts ' + r.days + ' days.'
      : '<b>Email is not connected yet</b>, so this was written to the outbox instead. '
        + 'Send them this link — it lasts ' + r.days + ' days and works once:'
        + '<div style="margin-top:7px;display:flex;gap:6px;align-items:center">'
        + '<input readonly value="' + esc(r.link) + '" style="flex:1;min-width:0;padding:6px 8px;'
        + 'font:400 11px/1.4 var(--mono,monospace);border:1px solid #e6d5a8;border-radius:7px;'
        + 'background:#fff">'
        + '<button type="button" class="btn btn-ghost btn-sm" data-copy>Copy</button></div>';

    const old = cell.querySelector('[data-invite-note]');
    if (old) old.remove();
    note.setAttribute('data-invite-note', '1');
    cell.appendChild(note);
  } catch (e) {
    alert(e.message || 'That did not send.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * Reset a student's password, and read it to them.
 *
 * "Send sign-in link" is the polite route and it needs a working inbox. This
 * is the one for the student on the phone who cannot get in: a new password on
 * the screen, every session they had signed out, and a forced change the next
 * time they use it — so what the office reads down the phone stops working the
 * moment they are in.
 *
 * Shown in the row rather than in a dialog, because a dialog is dismissed by
 * accident and the password is shown exactly once.
 */
async function resetPassword(id, btn) {
  const row = btn.closest('tr');
  const who = (row.querySelector('td b') || {}).textContent || 'this student';
  if (!confirm('Reset the password for ' + who + '?\n\nThey will be signed out '
    + 'everywhere, and will have to choose a new one the next time they sign in.')) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Resetting\u2026';
  try {
    const r = await api('POST', '/api/staff/people/' + id + '/password');
    const cell = row.querySelector('td');
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:7px;padding:9px 11px;border-radius:9px;font:600 11.8px/1.6 '
      + 'var(--sans);background:#eef8f2;border:1px solid #bfe0cc;color:#14603a;'
      + 'white-space:normal;max-width:340px';
    note.innerHTML = (r.sent
        ? 'Emailed to <b>' + esc(r.email) + '</b>. '
        : '<b>Email is not connected yet</b>, so nothing was sent \u2014 read this to them. ')
      + 'New password:<div style="margin-top:7px;display:flex;gap:6px;align-items:center">'
      + '<input readonly value="' + esc(r.password) + '" style="flex:1;min-width:0;padding:6px 8px;'
      + 'font:700 12px/1.4 var(--mono,ui-monospace,monospace);border:1px solid #bfe0cc;'
      + 'border-radius:7px;background:#fff">'
      + '<button type="button" class="btn btn-ghost btn-sm" data-copy>Copy</button></div>'
      + '<div style="margin-top:6px;font-weight:400;font-size:11.4px">Shown once. They choose '
      + 'their own the next time they sign in.</div>';
    const old = cell.querySelector('[data-pw-note]');
    if (old) old.remove();
    note.setAttribute('data-pw-note', '1');
    cell.appendChild(note);
  } catch (e) {
    alert(e.message || 'That did not work.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* Re-read the roster and redraw it. The initial load happens inside staffBoot
   and had no name, so nothing could ask for it again — and a select that
   changes a row has to be able to put the row back if the change is refused. */
async function paintRoster() {
  try {
    const st = await api('GET', '/api/staff/students');
    STUDENTS = st.students;
    paint();
  } catch (e) { /* leave what is on the screen */ }
}

document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-close]');
  if (!sel) return;
  const id = sel.dataset.close;
  const to = sel.value;
  const row = sel.closest('tr');
  const who = (row.querySelector('td b') || {}).textContent || 'this student';
  const words = to === 'completed'
    ? 'Close ' + who + '\u2019s file as completed?\n\nThey will be signed out and will '
      + 'not be able to sign in again. Anything still owed stays owed.'
    : to === 'left'
      ? 'Close ' + who + '\u2019s file as left part-way?\n\nThey will be signed out, and '
        + 'anything still owed moves from "still to collect" into "lost to drop-off".'
      : 'Reopen ' + who + '\u2019s file? They will be able to sign in again.';
  if (!confirm(words)) { await paintRoster(); return; }
  const note = to === 'active' ? '' : (prompt('A note, for the record. Optional.') || '');
  try {
    await api('PUT', '/api/staff/student/' + id + '/status', { status: to, note });
    toast(to === 'active' ? 'Reopened.' : 'Closed.');
    await paintRoster();
    await paintMoney();
  } catch (err) {
    toast('That did not work: ' + err.message);
    await paintRoster();
  }
});

document.addEventListener('click', e => {
  const inv = e.target.closest('[data-invite]');
  if (inv) { sendInvite(inv.dataset.invite, inv); return; }

  const pwr = e.target.closest('[data-pwreset]');
  if (pwr) { resetPassword(pwr.dataset.pwreset, pwr); return; }

  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const box = copy.previousElementSibling;
    box.select();
    /* execCommand, not navigator.clipboard: the office may well be on plain
       http on a laptop inside the building, where the clipboard API is not
       available at all and the button would silently do nothing. */
    try { document.execCommand('copy'); copy.textContent = 'Copied'; }
    catch (err) { copy.textContent = 'Press \u2318C'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 2200);
  }
});

/* ---------------------------------------------------------------- the money
 *
 * Four numbers, and then the list that makes them actionable.
 *
 * The split between "still to collect" and "lost to drop-off" is the whole
 * point. Both are money that has not arrived; only one of them is coming. They
 * were the same figure until a student could be marked as having left, which is
 * why that had to exist before this screen could tell the truth.
 */
/* ----------------------------------------------------------------- email
 *
 * "Is the email connected? SMTP I connected."
 *
 * It could not be answered from inside the site, and that is the defect —
 * bigger than any particular setting being wrong. Mail must never fail a
 * request (a student's sign-up cannot break because a mail server was slow),
 * so it fails silently by design, so it has to be VISIBLE by design too.
 */
async function paintMail() {
  let m;
  try { m = await api('GET', '/api/staff/mail'); }
  catch (e) { return; }

  const live = m.mode !== 'outbox';
  const chip = $('#mailMode');
  chip.className = 'st ' + (live ? 'ok' : 'bad');
  chip.style.textTransform = 'none';
  chip.style.letterSpacing = '0';
  chip.textContent = m.mode === 'api'
    ? 'Sending through ' + (m.providerLabel || 'a provider') + ' over HTTPS'
    : m.mode === 'smtp' ? 'Sending through ' + (m.host || 'your mail server')
                        : 'NOT sending — written to a file instead';

  $('#mailSays').innerHTML = live
    ? 'Password resets, order receipts and the sign-in details a student needs '
      + 'after they pay are going out from <b>' + esc(m.from) + '</b>.'
    : '<b style="color:#b03a2e">Nothing is being emailed.</b> Every message is '
      + 'written to a file on the server instead, and nobody receives it — '
      + 'including the password a student needs to get into the account they '
      + 'just paid for. '
      + (m.missing && m.missing.length
          ? 'Missing: <b>' + m.missing.map(esc).join(', ') + '</b>. '
          : '')
      + 'Pick a provider under <b>Change these settings</b> and paste their key '
      + '\u2014 that route works on hosts that block mail servers, which this one does.';

  /* The form, filled in from what is saved — never the password. */
  const sv = m.saved || {};
  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v || ''; };
  set('#mHost', sv.host); set('#mPort', sv.port); set('#mUser', sv.user);
  set('#mFrom', sv.from); set('#mOffice', sv.office);

  const sel = $('#mProvider');
  if (sel && !sel.options.length) {
    sel.innerHTML = '<option value="">a mail server (SMTP)</option>'
      + (m.providers || []).map(p =>
        '<option value="' + esc(p.id) + '">' + esc(p.label) + ' \u2014 over HTTPS</option>')
        .join('');
  }
  if (sel && document.activeElement !== sel) sel.value = sv.provider || '';
  const key = $('#mKey');
  if (key && document.activeElement !== key) {
    key.value = '';
    key.placeholder = sv.hasApiKey
      ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 \u2014 saved. Leave empty to keep it.'
      : 'paste the provider\u2019s key';
  }
  const pw = $('#mPass');
  if (pw && document.activeElement !== pw) {
    pw.value = '';
    pw.placeholder = sv.hasPassword ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 \u2014 saved. Leave empty to keep it.'
                                    : 'the mailbox password';
  }

  const WHERE = {
    office: 'set here, on this screen',
    environment: 'set in the hosting environment',
    file: 'set in mail.env on the server',
    none: 'not set anywhere',
  };

  $('#mailMore').innerHTML = [
    ['Where the settings come from', WHERE[m.source] || m.source || '—'],
    m.mode === 'api' ? ['Sent over', 'HTTPS \u2014 ' + (m.providerLabel || m.provider)] : null,
    ['From address', m.from || '—'],
    ['Office address', m.office || '—'],
    m.mode === 'smtp' ? ['Server', (m.host || '') + (m.port ? ':' + m.port : '')] : null,
    m.waiting ? ['Messages sitting undelivered on the server', m.waiting] : null,
    ['Sent since the last restart', (m.recent || []).length],
  ].filter(Boolean)
    .map(([k, v]) => '<li><span>' + esc(k) + '</span><b style="margin-left:auto">'
      + esc(String(v)) + '</b></li>').join('');
}

document.addEventListener('click', async e => {
  if (e.target.closest('#mailSave')) {
    const b = $('#mailSave');
    b.disabled = true;
    const was = b.textContent;
    b.textContent = 'Saving…';
    try {
      await api('PUT', '/api/staff/mail', {
        provider: $('#mProvider').value,
        /* Sent once, stored, never handed back — same rule as the password. */
        apiKey: $('#mKey').value,
        host: $('#mHost').value.trim(),
        port: $('#mPort').value.trim() || 587,
        user: $('#mUser').value.trim(),
        /* Sent once, stored, and never handed back. An empty box means "keep
           the one that is already saved", not "erase it". */
        pass: $('#mPass').value,
        from: $('#mFrom').value.trim(),
        office: $('#mOffice').value.trim(),
      });
      await paintMail();
      $('#mailSays').innerHTML = 'Saved, and in use from the next message. '
        + 'Press <b>Send me a test email</b> to prove it.';
      toast('Mail settings saved');
    } catch (err) { toast(err.message); }
    b.disabled = false;
    b.textContent = was;
    return;
  }

  if (!e.target.closest('#mailTest')) return;
  const b = $('#mailTest');
  b.disabled = true;
  const was = b.textContent;
  b.textContent = 'Sending…';
  try {
    const r = await api('POST', '/api/staff/mail/test',
      { to: ($('#mailTo') && $('#mailTo').value.trim()) || '' });
    /* Repaint FIRST, then say what happened — the other way round and the
       repaint overwrites the answer the person just asked for. */
    await paintMail();
    $('#mailSays').innerHTML = (r.ok ? '' : '<b style="color:#b03a2e">')
      + esc(r.said) + (r.ok ? '' : '</b>')
      + '';
  } catch (err) { toast(err.message); }
  b.disabled = false;
  b.textContent = was;
});

let MONEY = null;

async function paintMoney() {
  try { MONEY = await api('GET', '/api/staff/money'); }
  catch (e) { return; }

  $('#mExpected').textContent = inrPaise(MONEY.expected);
  $('#mReceived').textContent = inrPaise(MONEY.received);
  $('#mPending').textContent  = inrPaise(MONEY.pending);
  $('#mLost').textContent     = inrPaise(MONEY.lost);

  const chip = $('#moneyLate');
  chip.hidden = !MONEY.overdue;
  chip.textContent = inrPaise(MONEY.overdue) + ' overdue';

  $('#moneyMore').innerHTML = [
    ['GST inside what arrived', inrPaise(MONEY.gst)],
    ['Services delivered', MONEY.services],
    ['Orders on the book', MONEY.orders],
    ['Students on the books', MONEY.students.active],
    ['Files completed', MONEY.students.completed],
    ['Students who left part-way', MONEY.students.left],
  ].map(([k, v]) => '<li><span>' + esc(k) + '</span><b style="margin-left:auto">'
    + esc(String(v)) + '</b></li>').join('');

  const rows = (MONEY.owing || []);
  $('#owingPager').innerHTML = pagerHtml('owe', rows.length, 'to ring', paintMoney);
  $('#owingRows').innerHTML = rows.length
    ? paged('owe', rows).map(r =>
        '<tr' + (r.overdue ? ' class="late"' : '') + '>' +
        '<td><b>' + esc(r.name) + '</b><br>' +
          '<span style="font-size:11.6px;color:var(--muted)">' + esc(r.email) + '</span></td>' +
        '<td style="font-size:12.4px">' + esc(r.package || '—') + '</td>' +
        '<td><b>' + inrPaise(r.outstanding) + '</b><br>' +
          '<span style="font-size:11.4px;color:var(--muted)">of ' + inrPaise(r.gross) +
          '</span></td>' +
        '<td>' + (r.overdue
          ? '<span class="st bad">' + inrPaise(r.overdue) + '</span>'
          : '<span class="st ok">on schedule</span>') + '</td>' +
        '<td style="font-size:12.2px;color:var(--muted)">' +
          esc(r.since ? ago(r.since) : (r.nextDue ? 'due ' + ago(r.nextDue) : '')) + '</td>' +
        '<td style="white-space:nowrap">' + (r.studentId
          ? '<a class="btn btn-ghost btn-sm" href="counsellor.html?student=' + r.studentId +
            '">Open</a>'
          : '<span style="font-size:11.6px;color:var(--muted)">no account yet</span>') +
          '</td></tr>').join('')
    : '<tr><td colspan="6" style="padding:20px;color:var(--muted)">'
      + 'Nothing outstanding. Everything agreed has been collected.</td></tr>';
}

/* ------------------------------------------------------------- the orders */

let ORDERS = [], orderFilter = '', orderUnassigned = false;

const inrPaise = p => '\u20b9' + Math.round(Number(p || 0) / 100).toLocaleString('en-IN');

function whenShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/* An order that has an account behind it and nobody looking after it. A guest
   order is not one of these — there is no file to give anybody yet. */
const nobodyOn = o => !!o.studentId && !o.counsellorId;

function paintOrders() {
  const q = orderFilter.toLowerCase();
  const list = ORDERS.filter(o => (!orderUnassigned || nobodyOn(o)) && (!q ||
    (o.reference + ' ' + o.name + ' ' + o.email + ' ' + o.package).toLowerCase().includes(q)));

  const guests = ORDERS.filter(o => !o.studentId).length;
  const chip = $('#ordGuests');
  chip.hidden = !guests;
  chip.textContent = guests + (guests === 1 ? ' has no account yet' : ' have no account yet');

  const loose = ORDERS.filter(nobodyOn).length;
  const none = $('#ordNone');
  none.hidden = !loose && !orderUnassigned;
  none.textContent = orderUnassigned
    ? 'Showing the ' + loose + ' nobody is on ×'
    : loose + (loose === 1 ? ' order has nobody on it' : ' orders have nobody on them');

  $('#ordPager').innerHTML = pagerHtml('ord', list.length, 'orders', paintOrders);
  const otab = $('.otab[data-o="orders"] .n');
  if (otab) otab.textContent = list.length;

  $('#ordRows').innerHTML = paged('ord', list).map(o => {
    /* What they actually bought, by name. A row that says "services" and a
       total is no use to somebody on the phone to the person who bought it. */
    const what = o.kind === 'services'
      ? (o.items || []).map(x => esc(x.name || x.id)).join(', ') || 'Services'
      : esc(o.package || 'Package') +
        (o.publicUnis ? ' <span style="color:var(--muted)">\u00b7 ' + o.publicUnis +
          ' universities</span>' : '');

    return '<tr>' +
      '<td><b>' + esc(o.reference) + '</b></td>' +
      '<td>' + esc(o.name || '\u2014') +
        '<span style="display:block;font-size:11.6px;color:var(--muted)">' +
        esc(o.email || '') + (o.phone ? ' \u00b7 ' + esc(o.phone) : '') + '</span></td>' +
      '<td style="max-width:320px">' + what + '</td>' +
      '<td style="text-align:right;white-space:nowrap"><b>' + inrPaise(o.grossPaise) + '</b>' +
        /* Being paid in parts: what has arrived, and what has not. */
        (o.plan && o.plan.length
          ? '<span style="display:block;margin-top:2px;font-size:11.4px;color:var(--muted)">' +
            inrPaise(o.paidPaise || 0) + ' in \u00b7 ' +
            inrPaise((o.grossPaise || 0) - (o.paidPaise || 0)) + ' to come</span>'
          : '') +
        /* Paid, owed, or half way through a card payment. Before there was a
           gateway every order said "paid" and none of them were; now the word
           means what it says. */
        '<span style="display:block;margin-top:3px">' + ({
          paid: '<span class="st ok">paid</span>',
          part: '<span class="st wait">part paid</span>',
          owing: '<span class="st wait">to collect</span>',
          awaiting: '<span class="st wait">card started</span>',
          failed: '<span class="st bad">card failed</span>',
        }[o.status] || '<span class="st none">' + esc(o.status || '—') + '</span>') +
        '</span></td>' +
      '<td>' + (o.studentId
        ? '<a class="btn btn-ghost btn-sm" href="counsellor.html?student=' + o.studentId +
          '">' + esc(o.studentName || 'Open') + '</a>'
        : '<span class="st wait">no account yet</span>') + '</td>' +
      /* Who is doing this one. An order is the moment somebody has paid and is
         waiting to be dealt with, so it is the row where the question gets
         asked — and until this cell existed the answer had to be set two
         screens away, on a list that is sorted by name and not by what came
         in. A guest order has nobody to assign yet, so it says which button
         fixes that instead of showing a select that cannot be used. */
      '<td>' + (o.studentId
        ? assignCell(o.studentId, o.counsellorId)
        : '<span style="font-size:11.8px;color:var(--muted)">once they register</span>') +
        '</td>' +
      '<td style="white-space:nowrap;color:var(--muted);font-size:12.2px">' +
        esc(whenShort(o.at)) +
        /* What they accepted, and a way to read it. An order with nothing
           recorded against it is the one that gets argued about, so it says so
           rather than showing a blank cell. */
        (o.acceptedAt
          ? '<a href="/acceptance/' + encodeURIComponent(o.reference) + '" target="_blank" ' +
            'style="display:block;margin-top:4px;font-weight:700;color:var(--navy-700)">' +
            'Terms accepted</a>'
          : '<span style="display:block;margin-top:4px;color:#b03a2e;font-weight:700">' +
            'nothing recorded</span>') +
        '</td>' +
      '</tr>';
  }).join('') ||
    '<tr><td colspan="7" style="color:var(--muted);padding:22px">' +
    (ORDERS.length ? 'No order matches that.'
      : 'No orders yet. One appears here the moment somebody buys a package or a service ' +
        'on the site \u2014 whether or not they have an account.') + '</td></tr>';
}

document.addEventListener('click', e => {
  if (e.target && e.target.closest('#ordNone')) {
    orderUnassigned = !orderUnassigned;
    PAGE_AT.ord = 0;
    paintOrders();
  }
});

document.addEventListener('input', e => {
  if (e.target && e.target.id === 'findOrder') {
    orderFilter = e.target.value;
    PAGE_AT.ord = 0;           /* a new search starts at its first page */
    paintOrders();
  }
});

staffBoot(async me => {
  if (me.user.role !== 'admin') {
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>This screen is for admins</b>' +
      '<p>You are signed in as a counsellor. Your students and conversations are on the ' +
      'Conversations screen.</p><a class="btn btn-primary" href="counsellor.html">Open Conversations</a></div>';
    return;
  }

  const [ov, st, od] = await Promise.all([
    api('GET', '/api/staff/overview'),
    api('GET', '/api/staff/students'),
    api('GET', '/api/staff/orders'),
  ]);

  STUDENTS = st.students;
  COUNSELLORS = ov.counsellors;
  ORDERS = od.orders || [];

  $('#kStudents').textContent = ov.students;
  $('#kUnassigned').textContent = ov.unassigned;
  $('#kDocs').textContent = ov.docsWaiting;
  $('#kEnq').textContent = ov.enquiries;
  /* The count, with the money underneath it. "₹0" alone was what somebody saw
     after placing four orders — the total is zero because nothing has been
     charged yet, and the number of orders is the part they were looking for. */
  $('#kRev').textContent = ORDERS.length;
  const rev = $('#kRev').parentElement.querySelector('span');
  if (rev) {
    rev.innerHTML = 'Orders placed' +
      '<span style="display:block;font-weight:600;text-transform:none;letter-spacing:0;' +
      'font-size:11.4px;opacity:.75;margin-top:3px">' + inr(ov.revenuePaise) + ' agreed</span>';
  }
  paintOrders();
  /* And the other way round: if the conversations landed first they were
     painted without the names. */
  if (CONVS.length) paintConvs();

  ME = me.user.id;
  await paintPeople();

  $('#channels').innerHTML =
    '<li>' + ico('mail') + '<span style="flex:1">Email</span><span class="st ' +
      (ov.channels.mail === 'smtp' ? 'ok' : 'wait') + '">' +
      (ov.channels.mail === 'smtp' ? 'Sending' : 'Outbox only') + '</span></li>' +
    '<li>' + ico('chat') + '<span style="flex:1">WhatsApp</span><span class="st ' +
      (/^configured/.test(ov.channels.whatsapp) ? 'ok' : 'none') + '">' +
      (/^configured/.test(ov.channels.whatsapp) ? 'Configured' : 'Off') + '</span></li>' +
    '<li>' + ico('check') + '<span style="flex:1">Live messenger</span>' +
      '<span class="st ok">' + (ov.online.students + ov.online.staff) + ' online</span></li>';

  paint();
});

document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-assign]');
  if (!sel) return;
  const id = Number(sel.dataset.assign);
  const cid = sel.value === '' ? null : Number(sel.value);
  try {
    await api('PUT', '/api/staff/student/' + id + '/counsellor', { counsellorId: cid });
    const s = STUDENTS.find(x => x.id === id);
    const c = COUNSELLORS.find(x => x.id === cid);
    if (s) s.counsellor = c ? { id: c.id, name: c.name } : null;
    /* The same student is on three tabs, and one of them is the one being
       looked at. Reloading the screen to make the other two agree would throw
       away the search box, the page and the open tab, so the answer is written
       into all three lists and all three are repainted. */
    ORDERS.forEach(o => {
      if (o.studentId === id) {
        o.counsellorId = c ? c.id : null;
        o.counsellorName = c ? c.name : '';
      }
    });
    const conv = CONVS.find(x => x.id === id);
    if (conv) conv.counsellor = c ? { id: c.id, name: c.name } : null;
    toast(c ? 'Assigned to ' + c.name + ' — they can open the file now.'
            : 'Unassigned. Nobody but an admin can open that file now.');
    paint();
    paintOrders();
    paintConvs();
  } catch (err) {
    toast(err.message);
  }
});

$('#findStudent').addEventListener('input', e => {
  filter = e.target.value;
  PAGE_AT.stu = 0;             /* a new search starts at its first page */
  paint();
});

/* ------------------------------------------------------------------ the team */
/*
 * On a laptop the three demo accounts are created by the seeder and this screen
 * only ever had to list them. On a public address there are no demo accounts,
 * so an organisation starts as one administrator with nobody to answer the
 * chat — and until this existed there was no way inside the application to
 * change that.
 */

async function paintPeople() {
  const r = await api('GET', '/api/staff/people');
  PEOPLE = r.people;
  /* Counsellors and administrators. In an office this size the administrator
     IS somebody's counsellor, usually for the difficult files, and the server
     accepts either — this filter was the only thing still saying otherwise, so
     those students stayed unassigned and out of every caseload count. Website
     editors are excluded: a student handed to one is a student nobody rings. */
  COUNSELLORS = PEOPLE.filter(p => p.role === 'counsellor' || p.role === 'admin')
    .map(p => ({ id: p.id, name: p.name, caseload: p.caseload }));

  $('#counsellors').innerHTML = PEOPLE.map(p =>
    '<li>' + ico('user') +
    '<span style="flex:1"><b>' + esc(p.name) + '</b>' +
      (p.id === ME ? ' <span class="st none">you</span>' : '') +
      '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(p.email) + '</span></span>' +
    '<span class="st ' + (p.role === 'admin' ? 'ok' : p.caseload ? 'ok' : 'none') + '">' +
      (p.role === 'admin' ? 'Administrator'
        : p.role === 'editor' ? 'Website editor'
        /* Said out loud. A partner sitting on this list with nothing but a
           student count reads as a counsellor, and the difference between a
           counsellor and an outside agency is the whole point of the role. */
        : p.role === 'partner'
          ? 'Partner agency \u00b7 ' + p.caseload + ' sent'
        : p.caseload + ' student' + (p.caseload === 1 ? '' : 's')) + '</span>' +
    '</li>' +
    /* The permissions sit under the person rather than beside them: they are
       the answer to "what can this account do to the website", which is a
       different question from "who is this", and squeezing both onto one line
       made neither readable. */
    '<li style="padding-top:0;border-top:0;align-items:center;flex-wrap:wrap;gap:8px">' +
    '<span style="width:26px"></span>' +
    (p.role === 'admin'
      ? '<span class="st ok">Everything &mdash; administrators are not restricted</span>'
      /* Not a tick box in sight. These grant power over the WEBSITE, and a
         partner is not inside this business — offering the control and having
         the server refuse it is worse than never offering it. */
      : p.role === 'partner'
      ? '<span class="st none">Their own students, and nothing else on this site</span>'
      : PERMS.map(function (perm) {
          const on = p.perms.indexOf(perm[0]) >= 0;
          return '<button type="button" class="btn btn-ghost btn-sm" data-perm="' + p.id +
            '" data-key="' + perm[0] + '" data-on="' + (on ? '1' : '0') + '"' +
            ' style="border-color:' + (on ? '#c8e3d0' : '#e0e4ea') +
            ';background:' + (on ? '#f1f8f3' : 'transparent') +
            ';color:' + (on ? '#1d5c33' : 'var(--muted)') + '">' +
            (on ? '\u2713 ' : '') + perm[1] + '</button>';
        }).join('')) +
    '<span style="flex:1"></span>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-pw="' + p.id +
      '">Reset password</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + p.id +
      '" style="margin-left:6px">Edit</button>' +
    /* Not on yourself. Deleting the account you are signed in as leaves nobody
       able to undo it, and the server refuses anyway — offering the button and
       then refusing is worse than not offering it. */
    (p.id === ME ? '' :
      '<button type="button" class="btn btn-ghost btn-sm" data-del="' + p.id +
        '" style="margin-left:6px;color:#b03a2e">Delete</button>') +
    (p.id === ME ? '' :
      '<select data-role="' + p.id + '" style="margin-left:6px;padding:6px 9px;' +
      'font:600 12.2px/1.3 var(--sans);border:1.5px solid #d8dde4;border-radius:8px">' +
      [['counsellor', 'Counsellor'], ['editor', 'Website editor'],
       ['admin', 'Administrator'], ['partner', 'Partner agency']]
        .map(function (r) {
          return '<option value="' + r[0] + '"' + (p.role === r[0] ? ' selected' : '') + '>' +
            r[1] + '</option>';
        }).join('') + '</select>')
    + '</li>').join('') || '<li><span>Nobody yet</span></li>';

  paint();
}

function showPassword(title, name, email, password) {
  $('#pTitle').textContent = title;
  $('#pForm').style.display = 'none';
  $('#pButtons').style.display = 'none';
  $('#pErr').style.display = 'none';
  const box = $('#pDone');
  box.style.display = '';
  box.innerHTML =
    '<p style="margin:0 0 12px;font:600 13.4px/1.55 var(--sans)">' + esc(name) +
      (email ? ' &mdash; <span style="font-weight:500;color:var(--muted)">' + esc(email) + '</span>' : '') +
    '</p>' +
    '<div style="padding:14px 16px;border-radius:12px;background:var(--paper);' +
      'border:1.5px dashed #c9a227"><span style="display:block;font:800 10.4px/1 var(--sans);' +
      'letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px">' +
      'Password</span><code style="font:700 17px/1.3 ui-monospace,monospace;' +
      'word-break:break-all">' + esc(password) + '</code></div>' +
    '<p style="margin:12px 0 0;font:600 12.6px/1.55 var(--sans);color:#7a5510">' +
      'Copy it now and send it to them. It is stored hashed, so this is the only time it ' +
      'can be shown &mdash; close this and it is gone.</p>' +
    '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-primary" id="pCopy">Copy the password</button>' +
      '<button type="button" class="btn btn-ghost" data-close>Done</button></div>';
}

function openPersonForm() {
  $('#pTitle').textContent = 'Add someone to the team';
  $('#pForm').style.display = '';
  $('#pButtons').style.display = 'flex';
  $('#pDone').style.display = 'none';
  $('#pErr').style.display = 'none';
  ['pName', 'pEmail', 'pPhone'].forEach(id => { $('#' + id).value = ''; });
  $('#pRole').value = 'counsellor';
  $('#pPermContent').checked = false;
  $('#pPermCatalogue').checked = false;
  syncRole();
  $('#personModal').classList.add('on');
  setTimeout(() => $('#pName').focus(), 50);
}

document.addEventListener('click', async e => {
  if (e.target.closest('#addPerson')) return openPersonForm();
  if (e.target.closest('[data-close]') || e.target === $('#personModal')) {
    $('#personModal').classList.remove('on');
    return;
  }

  if (e.target.closest('#pCopy')) {
    const code = $('#pDone code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      toast('Copied.');
    } catch (err) {
      /* Clipboard access is refused on an insecure origin and in some browsers
         without a gesture it trusts. Selecting it is not as good and is better
         than a button that silently fails. */
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Copy it with Cmd-C — this browser would not let the button do it.');
    }
    return;
  }

  if (e.target.closest('#pSave')) {
    const btn = e.target.closest('#pSave');
    const body = {
      name: $('#pName').value, email: $('#pEmail').value,
      phone: $('#pPhone').value, role: $('#pRole').value,
      perms: [$('#pPermContent').checked && 'content',
              $('#pPermCatalogue').checked && 'catalogue'].filter(Boolean),
    };
    $('#pErr').style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const r = await api('POST', '/api/staff/people', body);
      await paintPeople();
      showPassword('Account created', r.person.name, r.person.email, r.password);
      toast(r.person.name + ' can sign in now.');
    } catch (err) {
      $('#pErr').textContent = err.message;
      $('#pErr').style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create the account';
    }
    return;
  }

  /* Fixing a name, an email or a phone. The email is the sign-in, so a typo in
     it locks somebody out of their own account with no way in from their side —
     which is why this exists at all. */
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const p = PEOPLE.find(x => String(x.id) === ed.dataset.edit);
    if (!p) return;
    const name = prompt('Name', p.name);
    if (name === null) return;
    const email = prompt('Email \u2014 this is what they sign in with', p.email);
    if (email === null) return;
    const phone = prompt('Phone', p.phone || '');
    if (phone === null) return;
    try {
      await api('PUT', '/api/staff/people/' + p.id, { name, email, phone });
      await paintPeople();
      toast('Saved.');
    } catch (err) { toast(err.message); }
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del) {
    const p = PEOPLE.find(x => String(x.id) === del.dataset.del);
    if (!p) return;
    const load = p.caseload || 0;
    if (!confirm('Delete ' + p.name + ' (' + p.email + ')?\n\n'
      + (load ? 'Their ' + load + ' student(s) become unassigned and will need '
                + 'somebody else.\n\n' : '')
      + 'Everything of theirs goes with them and this cannot be undone.')) return;
    try {
      const r = await api('DELETE', '/api/staff/people/' + p.id);
      await paintPeople();
      await paintRoster();
      toast(r.unassigned
        ? 'Deleted. ' + r.unassigned + ' student(s) now need a counsellor.'
        : 'Deleted.');
    } catch (err) { alert(err.message); }
    return;
  }

  const pw = e.target.closest('[data-pw]');
  if (pw) {
    const p = PEOPLE.find(x => x.id === Number(pw.dataset.pw));
    if (!confirm('Reset the password for ' + p.name + '? They will be signed out everywhere '
      + 'and will need the new password to get back in.')) return;
    try {
      const r = await api('POST', '/api/staff/people/' + p.id + '/password');
      $('#personModal').classList.add('on');
      showPassword('New password', r.name, p.email, r.password);
    } catch (err) { toast(err.message); }
    return;
  }

  const pm = e.target.closest('[data-perm]');
  if (pm) {
    const p = PEOPLE.find(x => x.id === Number(pm.dataset.perm));
    const key = pm.dataset.key;
    const next = pm.dataset.on === '1'
      ? p.perms.filter(x => x !== key)
      : p.perms.concat([key]);
    try {
      await api('PUT', '/api/staff/people/' + p.id + '/perms', { perms: next });
      await paintPeople();
      toast(p.name + (next.indexOf(key) >= 0 ? ' can now change ' : ' can no longer change ') +
        (key === 'content' ? 'the home page.' : 'the universities.'));
    } catch (err) { toast(err.message); }
    return;
  }
});

/* The role picker is a <select>, so it arrives on change and not on click. */
document.addEventListener('change', async e => {
  const rl = e.target.closest('select[data-role]');
  if (!rl) return;
  const p = PEOPLE.find(x => x.id === Number(rl.dataset.role));
  const to = rl.value;
  const what = to === 'admin'
    ? 'an administrator — they will be able to see every student and every file, and add people.'
    : to === 'editor'
      ? 'a website editor — they lose all student records and see only the parts of the site '
        + 'they are allowed to change.'
      : 'a counsellor — they see the students assigned to them, and the chat.';
  if (!confirm(p.name + ' becomes ' + what)) { await paintPeople(); return; }
  try {
    await api('PUT', '/api/staff/people/' + p.id + '/role', { role: to });
    await paintPeople();
    toast(p.name + ' is now a ' + (to === 'editor' ? 'website editor' : to) + '.');
  } catch (err) {
    toast(err.message);
    await paintPeople();
  }
});

/* An administrator has every permission by definition, so offering the boxes
   next to that choice would be offering something that does nothing. */
function syncRole() {
  const role = $('#pRole').value;
  /* An administrator has every permission by definition, a student has none
     of them, and a partner agency is not inside this business at all —
     offering the boxes next to any of the three is offering something that
     does nothing. The server sets a partner's permissions to an empty list on
     purpose, so a tick here was a control that would be silently discarded. */
  $('#pPermBox').style.display =
    (role === 'admin' || role === 'student' || role === 'partner') ? 'none' : '';
  if (role === 'editor' && !$('#pPermContent').checked && !$('#pPermCatalogue').checked) {
    $('#pPermContent').checked = true;
  }
  const note = $('#pStudentNote');
  if (note) note.style.display = role === 'student' ? '' : 'none';
  const pn = $('#pPartnerNote');
  if (pn) pn.style.display = role === 'partner' ? '' : 'none';
}
$('#pRole').addEventListener('change', syncRole);

addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#personModal').classList.remove('on');
});

/* ------------------------------------------------- reading the conversations */
/*
 * "Admin should be able to see all the chats, everything related to the
 * student. In case a counsellor is not writing messages correctly he should be
 * able to guide him."
 *
 * The list, not the search: which threads are waiting, on whom, and for how
 * long. Opening one goes to the student's file, where the whole conversation
 * is; guiding one writes a note the student never sees.
 */
let CONVS = [], CONV_SUM = {}, onlyWaiting = false;
/* Which counsellor's threads are showing. null is everybody; the string
   'none' is the pile nobody owns, which is the one worth looking at. */
let convWho = null;

const ago = iso => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
};

function paintConvs() {
  const rows = CONVS
    .filter(c => !onlyWaiting || !!c.waitingSince)
    .filter(c => convWho === null
      || (convWho === 'none' ? !c.counsellor
                             : c.counsellor && String(c.counsellor.id) === convWho));
  const late = (CONV_SUM.late || 0);
  const silent = (CONV_SUM.silent || 0);
  const chip = $('#chatLate');
  if (chip) {
    /* Two different problems, and the one nobody has started is the worse of
       them, so it is said first. */
    const parts = [];
    if (silent) parts.push(silent + ' not started');
    if (late) parts.push(late + ' waiting over a day');
    chip.hidden = !parts.length;
    chip.textContent = parts.join(' · ');
  }

  $('#convWho').innerHTML = (CONV_SUM.byCounsellor || []).map(p => {
    const key = p.id == null ? 'none' : String(p.id);
    const on = convWho === key;
    return '<button type="button" class="cw' + (p.late ? ' hot' : '') +
      '" data-cw="' + key + '" aria-pressed="' + on + '">' +
      '<b>' + esc(p.name) + '</b>' +
      '<span>' + p.threads + ' thread' + (p.threads === 1 ? '' : 's') +
        (p.late ? ' · ' + p.late + ' waiting over a day' : '') + '</span>' +
      '<i>' + p.fromUs + ' from us · ' + p.fromThem + ' from them</i>' +
    '</button>';
  }).join('')
    || '<p style="margin:0;color:var(--muted);font-size:12.6px">No conversations yet.</p>';

  /* Which slice is on screen, and the way back. A filter with no way out is a
     screen that has broken, as far as anybody using it can tell. */
  const whoChip = $('#convChip');
  if (whoChip) {
    if (convWho === null) {
      whoChip.hidden = true;
    } else {
      const picked = (CONV_SUM.byCounsellor || [])
        .find(p => (p.id == null ? 'none' : String(p.id)) === convWho);
      whoChip.hidden = false;
      whoChip.innerHTML = 'Showing ' +
        esc(picked ? picked.name : 'one counsellor') +
        ' · <button type="button" class="lnk" data-cw-all>show everyone</button>';
    }
  }

  $('#convPager').innerHTML = pagerHtml('conv', rows.length, 'conversations', paintConvs);
  const ctab = $('.otab[data-o="chats"] .n');
  if (ctab) ctab.textContent = rows.length;

  $('#convRows').innerHTML = paged('conv', rows).map(c =>
    '<tr' + (c.waitingHours >= 24 || c.messages === 0 ? ' class="late"' : '') + '>' +
      /* The name is the link. Read it lives in the last column of a six
         column table, which on a phone is 1,180px inside a 356px box — so the
         one control that opens the conversation was off the right-hand edge
         and the screen read as dead to the touch. The first thing under a
         thumb now opens the thread. */
      '<td><a class="cvopen" href="counsellor.html?student=' + c.id + '">' +
        '<b>' + esc(c.name) + '</b></a>' +
        '<span style="display:block;font-size:11.6px;color:var(--muted)">' +
        esc(c.email) + '</span></td>' +
      /* A thread nobody owns is the one that goes unanswered, and this screen
         is where that is noticed. Saying "nobody" in red and making somebody
         go and find the student on another tab to fix it is how a message sits
         for three days. */
      '<td>' + assignCell(c.id, c.counsellor ? c.counsellor.id : null) + '</td>' +
      /* A student nobody has written to has no "last said", and printing an
         empty cell reads as a loading bug. Say the thing instead — it is the
         most actionable row on this screen. */
      '<td style="max-width:330px">' + (c.messages === 0
        ? '<span style="font-size:12.7px;color:#b03a2e;font-weight:700">'
          + 'Nothing said yet</span>'
          + '<span style="display:block;font-size:11.4px;color:var(--muted)">'
          + 'Nobody has written to this student</span>'
        : '<span style="font-size:12.4px;color:var(--muted)">'
          + (c.lastFrom === 'student' ? 'They: ' : 'Us: ') + '</span>'
          + '<span style="font-size:12.7px">' + esc(c.lastBody) + '</span>'
          + '<span style="display:block;font-size:11.4px;color:var(--muted)">'
          + ago(c.lastAt) + '</span>') + '</td>' +
      /* Waiting is whether the student spoke last, not how long ago. A message
         from ten minutes ago that nobody has answered is waiting; saying
         "answered" because it is under an hour old is the screen lying to make
         itself look better. */
      '<td>' + (c.messages === 0
        ? '<span class="st bad">not started</span>'
        : c.waitingSince
          ? '<span class="st ' + (c.waitingHours >= 24 ? 'bad' : 'wait') + '">' +
            ago(c.waitingSince) + '</span>'
          : '<span class="st ok">answered</span>') + '</td>' +
      '<td style="font-size:12.4px;white-space:nowrap">' + c.fromUs + ' / ' + c.fromThem +
        (c.guidance ? '<span style="display:block;font-size:11.2px;color:var(--muted)">' +
          c.guidance + ' note' + (c.guidance === 1 ? '' : 's') +
          (c.guidanceUnread ? ' · ' + c.guidanceUnread + ' unread' : '') + '</span>'
          : '') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<a class="btn btn-ghost btn-sm" href="counsellor.html?student=' + c.id +
          '">' + (c.messages === 0 ? 'Open' : 'Read it') + '</a> ' +
        '<button type="button" class="btn btn-ghost btn-sm" data-guide="' + c.id +
          '">Guide</button></td>' +
    '</tr>').join('')
    || '<tr><td colspan="6" style="padding:22px;color:var(--muted)">' +
       (!CONVS.length ? 'No conversations yet.'
         : convWho !== null ? 'Nothing here for that counsellor. Press their card '
           + 'again, or show everyone.'
         : 'Nothing is waiting on us.') + '</td></tr>';
}

async function loadConvs() {
  try {
    const r = await api('GET', '/api/staff/conversations');
    CONVS = r.conversations;
    CONV_SUM = r.summary;
    /* This runs alongside the boot that fills COUNSELLORS, not after it, and
       whichever finishes first used to win. Painting a row of assign controls
       from an empty list gives every thread a select with one option in it and
       the word "unassigned" against a student who has a counsellor — the
       screen contradicting the summary directly above it. The same list comes
       back with the conversations, so take it if the other one has not
       arrived. */
    if (!COUNSELLORS.length && r.counsellors) COUNSELLORS = r.counsellors;
    paintConvs();
  } catch (e) { /* not an administrator: the section stays empty */ }
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'onlyWaiting') {
    onlyWaiting = e.target.checked;
    PAGE_AT.conv = 0;
    paintConvs();
  }
});

/* Delegated, because the cards are repainted every time the conversations
   reload and a handler bound to the element would go with it. */
document.addEventListener('click', e => {
  const back = e.target.closest && e.target.closest('[data-cw-all]');
  if (back) {
    convWho = null;
    PAGE_AT.conv = 0;
    paintConvs();
    return;
  }
  const card = e.target.closest && e.target.closest('.cw[data-cw]');
  if (!card) return;
  /* Pressing the one already showing goes back to everybody, so the card is
     its own way out as well as its way in. */
  convWho = convWho === card.dataset.cw ? null : card.dataset.cw;
  PAGE_AT.conv = 0;
  paintConvs();
});

document.addEventListener('click', async e => {
  const g = e.target.closest('[data-guide]');
  if (!g) return;
  const c = CONVS.find(x => String(x.id) === g.dataset.guide);
  if (!c) return;
  if (!c.counsellor) {
    toast('Nobody is looking after ' + c.name + ' yet, so there is nobody to tell.');
    return;
  }
  const body = prompt('A note to ' + c.counsellor.name + ' about ' + c.name
    + '.\nThe student never sees this.');
  if (!body || !body.trim()) return;
  try {
    await api('POST', '/api/staff/student/' + c.id + '/guide', { body: body.trim() });
    toast('Sent to ' + c.counsellor.name + '. It is on the student\'s file for them, '
      + 'and nowhere the student can reach.');
    await loadConvs();
  } catch (err) { toast(err.message); }
});

loadConvs();
paintMoney();
paintMail();
"""
