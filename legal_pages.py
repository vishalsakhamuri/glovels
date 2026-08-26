"""
The four legal pages: Terms of Use, Privacy, Refund & Cancellation, Grievance.

WHAT THESE ARE. Drafts, written from what this business actually does — the
packages on the home page, the guarantee on the Boarding Pass card, the
documents students upload into the portal, the enquiry the chat box creates.
They are not a lawyer's work and they say so nowhere on the page, because a
customer-facing policy that announces its own uncertainty is worse than useless.
The honest disclosure belongs to the office, and it is on the Legal tab.

HOW THEY ARE PUT TOGETHER. Two halves, on purpose:

  * The PROSE is built. It lives here, it is patched into the four pages by
    apply_fixes.py, and changing it means changing this file — the same as every
    other page on this site.

  * The PARTICULARS are live. CIN, GSTIN, the registered address, the named
    grievance officer, the effective date: those come from the `legal` content
    block at load, so a wrong digit in a GSTIN is fixed from the office in ten
    seconds rather than in a deploy. Four pages quoting the same number from one
    place cannot drift apart.

  * The PACKAGE TERMS are live too, and per package. The pledge on a card is one
    sentence; the contract behind it is the `terms` field on that package, and
    it is rendered into refunds.html#guarantee-terms, which is where both cards
    have been linking all along.

A particular that has not been filled in does not render as a blank or a dash —
its whole row is left out, and the Legal tab counts what is missing. A page that
says "CIN: —" looks broken to a customer and tells them nothing; a page without
that line just reads as a policy.
"""

# --------------------------------------------------------------- the defaults

# The template that ships on the guaranteed package. It is a starting point the
# office is meant to edit — Vishal asked for exactly that — so it is written to
# be edited: one clause per line, no cross-references, nothing that breaks if a
# line is deleted.
GUARANTEE_TEMPLATE = """\
What the guarantee covers
This package includes an admission guarantee. If no university on your agreed \
shortlist makes you an admission offer, we return the package fee in full, \
including the GST charged on it.

What "your agreed shortlist" means
After you buy, a counsellor calls you and the two of you agree a shortlist in \
writing — by email or in your dashboard. That written shortlist is what the \
guarantee applies to. Until it exists, the guarantee has nothing to attach to.

What we do
We prepare and submit every application on the agreed shortlist, and we pursue \
each one until that university has given an answer.

What voids the guarantee
The guarantee does not apply if an application fails because a deadline we set \
in writing was missed; because a document supplied to us was false, forged or \
materially incomplete; because you declined an offer that was made, or let it \
lapse; or because you insisted on universities outside the agreed shortlist.

What we do not decide
Admission is decided by the university and the visa is decided by the \
consulate. Neither is ours to give, and the guarantee is about the offer, not \
about the visa or about your arrival.

How to claim
Write to the grievance officer named on this page once the last university on \
your agreed shortlist has answered. We verify the shortlist and the answers, \
and pay within 45 working days of that last answer.
"""

REFUND_RULE = """\
<p>Fees are not refundable once paid. Our work begins with the first counselling \
call — the reading of your marksheets, the shortlist, the applications — and it \
is not recoverable once it has been done.</p>

<p>Three things are not affected by that, and cannot be signed away:</p>

<ul>
<li>If we do not deliver a service you paid for, you are entitled to your money
  back for it. That is the law and this policy does not displace it.</li>
<li>If we cancel, or cannot carry out the service, we refund in full.</li>
<li>The admission guarantee on a package that carries one is a separate promise
  we have made to you, and it pays out on its own terms — see below.</li>
</ul>

<p>If you were charged twice for the same thing, or charged an amount you did \
not authorise, tell us and we will return it. That is a mistake, not a \
cancellation.</p>
"""


# The other pledged package promises effort, not money back — "every
# application pursued to a decision". That is a real commitment and it needs
# real terms, but they are not the same terms, which is exactly why this field
# sits on the package rather than on the page.
PURSUIT_TEMPLATE = """\
What this package commits us to
We prepare and submit every application on your agreed shortlist, and we pursue \
each one until that university has given an answer — an offer, a rejection or a \
withdrawal. We do not close an application because it has gone quiet.

What "your agreed shortlist" means
After you buy, a counsellor calls you and the two of you agree a shortlist in \
writing — by email or in your dashboard. That written shortlist is what this \
commitment applies to.

What this package does not include
This package does not carry a money-back admission guarantee. If you want one, \
it is on the package that says so on its card. Fees under this package are not \
refundable once paid, on the terms set out above.

What we do not decide
Admission is decided by the university and the visa is decided by the \
consulate. Neither is ours to give.

If we have not done it
If an application on your agreed shortlist was not submitted, or was abandoned \
before that university answered, write to the grievance officer named on this \
page. Where we have not delivered the service, you are entitled to your money \
back for it.
"""


# ------------------------------------------------------------------ the pages
#
# Each body slots into <section class="block"><div class="wrap prose"> … </div>.
# `data-legal` marks a value filled at load; `data-legal-row` marks a whole
# element removed when its value is empty.

PARTICULARS = """
<h2 id="who-we-are">Who you are dealing with</h2>
<p>This site is operated by <b data-legal="entity">Glovels Consultants Private
  Limited</b> ("Glovels", "we", "us"), a company registered in India.</p>
<ul class="legal-particulars">
  <li data-legal-row="cin">Corporate Identity Number: <b data-legal="cin"></b></li>
  <li data-legal-row="gstin">GSTIN: <b data-legal="gstin"></b></li>
  <li data-legal-row="address">Registered office:
    <span data-legal="address"></span></li>
  <li>Email: <a href="mailto:info@glovels.com">info@glovels.com</a></li>
</ul>
<p data-legal-row="effective" class="legal-eff">In effect from
  <b data-legal="effective"></b>.</p>
"""


TERMS = """
<p class="lead">These terms govern your use of this website and any service you
  buy through it. Using the site means you accept them.</p>
""" + PARTICULARS + """
<h2>Where we are, and how the service reaches you</h2>
<p>Glovels is delivered online. Your shortlist, your applications, your
  documents, your payments and your conversation with your counsellor all live
  in your account, and everything we owe you under these terms is performed
  there or by phone, email or video. <b>Nothing in any service we sell requires
  you to attend an office</b>, and no counsellor may make attendance a condition
  of anything.</p>
<p>The company is registered in India at the address above, and its work is
  carried out by people in India and in Germany. Where a service names a place —
  a document collected in person, a test centre, a consulate appointment — that
  place is stated on the service itself. Our operating address for correspondence
  is Plot 60, H. No. 1-102, 1st Floor, Madhapur, Hyderabad 500081, Telangana,
  India.</p>

<h2>What we do, and what we do not</h2>
<p>We are an education consultancy. We match students to universities abroad —
  public universities in particular — and we help with the work of getting there:
  shortlisting, applications, statements of purpose and letters of
  recommendation, scholarships, education loans, blocked accounts, insurance,
  fee transfers and visa paperwork.</p>
<p>We are not a university, an agent of any university, or any part of a
  government. We do not decide admissions and we do not grant visas.
  <b>An admission is decided by the university. A visa is decided by the
  consulate.</b> Where a package carries an admission guarantee, that guarantee
  is a promise about our fee and is set out in full on the
  <a href="refunds.html">Refund and Cancellation policy</a>.</p>

<h2>What the university finder shows you</h2>
<p>The finder matches you against a catalogue we maintain of programmes, fees,
  intakes and entry requirements. We keep it current and we check it, but
  universities change fees, deadlines and requirements without telling us, and
  the university's own website is the authority. Anything the finder shows is
  an indication to act on, not a representation you should rely on without
  checking.</p>
<p>Some information — the names of public universities you match, and their
  fees — is shown in full only to students who have bought a package that
  includes it. What a package includes is stated on the package.</p>

<h2>Your account</h2>
<p>The student dashboard holds your shortlist, your documents, your
  applications and your conversation with your counsellor. You are responsible
  for your password and for what is done with your account. Tell us at once if
  you think somebody else has it.</p>
<p>You must be 18 or over to hold an account. If you are younger, a parent or
  guardian must open it and deal with us on your behalf.</p>

<h2>What you have to give us, and what happens if it is wrong</h2>
<p>Everything we do rests on your documents and on what you tell us. Marksheets,
  test scores, passports, funds statements and work history must be true,
  complete and yours. A university that finds otherwise will reject the
  application, and may bar you from applying again; a consulate may refuse a
  visa and record the refusal.</p>
<p>We do not verify documents for authenticity and we do not present them as
  verified. If a document you gave us turns out to be false or materially
  incomplete, we may stop work without refund, and any guarantee attached to
  your package does not apply.</p>

<h2>Deadlines</h2>
<p>Applications run on the university's calendar, not ours or yours. When we set
  you a deadline in writing for a document, a payment or a decision, meeting it
  is your part of the arrangement. If a deadline is missed and an application
  fails because of it, that is not a failure of the service.</p>

<h2>Fees, GST and what a price includes</h2>
<p>Prices on this site are in Indian rupees and include GST at the rate shown at
  checkout. The price of a package covers the services listed on that package
  and nothing else. Third-party costs are yours and are not included: university
  application fees, tuition, deposits, blocked-account fees, test fees, visa
  fees, biometrics, translation, apostille, courier and travel.</p>
<p>We may change our prices at any time. A change never affects a package you
  have already bought.</p>

<h2>Cancellation and refunds</h2>
<p>Set out separately, on the
  <a href="refunds.html">Refund and Cancellation policy</a>. In short: fees are
  not refundable once paid, save where a service was not delivered, where we
  cancel, or where an admission guarantee pays out.</p>

<h2>What we write for you</h2>
<p>The studio on this site helps you draft a statement of purpose or a letter of
  recommendation from things you tell it about yourself. It arranges your own
  material — it does not invent achievements, grades or titles, and you must not
  add any. The draft is a starting point and the final document is yours: you
  are the one signing it, and you are responsible for it being true.</p>

<h2>Our material</h2>
<p>The text, design, catalogue and tools on this site belong to us. You may use
  them to plan your own education. You may not copy the catalogue, scrape the
  site, or resell any part of it.</p>

<h2>What we are responsible for</h2>
<p>We are responsible for doing our work with reasonable care and skill, and for
  the promises we make on the packages we sell you. We are not responsible for
  decisions that are not ours: an admission refused, a visa refused, a fee a
  university changes, a deadline a university moves, or a delay at a bank or a
  consulate.</p>
<p>Where we are liable to you, our liability is limited to the fee you paid us
  for the service concerned. Nothing here limits liability for fraud, or for
  anything that cannot be limited by law.</p>

<h2>Ending the arrangement</h2>
<p>You may stop using the site at any time; the refund policy governs money
  already paid. We may suspend or close an account that supplies false
  documents, abuses our staff, or uses the site to do something unlawful.</p>

<h2>Complaints</h2>
<p>If something has gone wrong, the
  <a href="grievance.html">Grievance Redressal</a> page names the person whose
  job it is to deal with it and the time in which they must reply.</p>

<h2>Law and jurisdiction</h2>
<p>These terms are governed by the law of India, and the courts at
  <span data-legal="jurisdiction">Hyderabad, Telangana</span> have exclusive
  jurisdiction.</p>

<h2>Changes to these terms</h2>
<p>We may change these terms. The version on this page is the one that applies,
  and the date it took effect is shown above. A change does not alter the terms
  of a package you have already bought.</p>
"""


PRIVACY = """
<p class="lead">What we collect about you, why, how long we keep it, and how you
  get it back or get it deleted.</p>
""" + PARTICULARS + """
<h2>What we collect</h2>
<p><b>When you use the site without signing in.</b> Your answers in the
  university finder — destination, level, field, CGPA, budget, intake. If you
  open the chat box we ask for your name and a phone number or email before the
  first message, so that a counsellor can answer you and call you back.</p>
<p><b>When you enquire or book counselling.</b> Your name, phone number, email
  and the destination you are interested in.</p>
<p><b>When you hold a student account.</b> Everything above, plus what you put
  in your profile — date of birth, address, education history, test scores, work
  history, passport details — the documents you upload, your shortlist, your
  applications and your conversation with your counsellor.</p>
<p><b>When you buy.</b> The package or services, the amount, the GST and the
  reference. Payment card details are handled by the payment provider and never
  reach us.</p>

<h2>Documents, and why they are sensitive</h2>
<p>Marksheets, passports, funds statements and medical or police certificates
  are sensitive personal data. They are held to serve your applications and
  nothing else. They are visible to you, to the counsellor assigned to you and
  to an administrator; they are not visible to other counsellors, and the rule
  is enforced on our server rather than by hiding a row on a screen.</p>

<h2>Why we hold it</h2>
<ul>
  <li>To match you to universities and to prepare and submit your applications
    — the service you came for.</li>
  <li>To answer you, call you back, and keep your counsellor informed.</li>
  <li>To keep records we are required to keep: invoices, GST records and the
    log of a complaint and how it was settled.</li>
</ul>
<p>We do not sell your data, and we do not use it for advertising.</p>

<h2>Who we share it with</h2>
<ul>
  <li><b>Universities and their application platforms</b>, when we apply on your
    behalf. This is the point of the service and it is what your documents are
    for.</li>
  <li><b>Banks, blocked-account providers, insurers and forex providers</b>,
    where you have asked us to arrange one of those.</li>
  <li><b>Our hosting and email providers</b>, who process data on our
    instructions and hold it no longer than we do.</li>
  <li><b>An authority</b>, where the law requires it of us.</li>
</ul>
<p>Applying to a university abroad means sending your data abroad. Where a
  university is outside India, your application and its documents go with it —
  that is unavoidable, and by asking us to apply you are asking us to send
  them.</p>

<h2>How long we keep it</h2>
<ul>
  <li><b>An enquiry that goes nowhere:</b> two years from your last contact
    with us, then deleted.</li>
  <li><b>A student account:</b> for as long as the account is open, and three
    years after your last application, so that we can answer a question about
    an application you made.</li>
  <li><b>Documents you upload:</b> deleted with the account, or earlier if you
    ask.</li>
  <li><b>Invoices and GST records:</b> as long as tax law requires, which is
    longer than the rest and is not ours to shorten.</li>
</ul>

<h2>What you can ask for</h2>
<ul>
  <li><b>A copy</b> of what we hold about you.</li>
  <li><b>A correction</b> of anything wrong or out of date.</li>
  <li><b>Deletion</b> of your account and your documents. We will do it, except
    for records tax law requires us to keep and for anything needed to settle a
    complaint that is still open.</li>
  <li><b>To withdraw consent</b> to us contacting you. If you withdraw it while
    an application is in progress, we may not be able to carry on with it.</li>
</ul>
<p>Write to the officer named on the
  <a href="grievance.html">Grievance Redressal</a> page. We answer within thirty
  days, and sooner where we can.</p>

<h2>How it is protected</h2>
<p>The site is served over HTTPS. Passwords are stored hashed, so nobody here —
  including us — can read yours back; if it is lost it is reset, not recovered.
  Access to student records is restricted to the counsellor assigned to you and
  to an administrator. No system is perfect, and we do not claim ours is; if
  data is breached in a way that puts you at risk, we will tell you and the
  authority.</p>

<h2>Cookies</h2>
<p>We set one cookie, to keep you signed in. It is not used to track you across
  other sites and there is no advertising cookie on this site.</p>

<h2>Children</h2>
<p>This service is for people aged 18 and over. We do not knowingly collect data
  about anyone younger except through a parent or guardian acting for them.</p>

<h2>Changes</h2>
<p>We may change this policy. The version on this page is the one that applies,
  and the date it took effect is shown above.</p>
"""


REFUNDS = """
<p class="lead">What happens to your money if you change your mind, if we cannot
  do what we said, and if an admission guarantee has to pay out.</p>
""" + PARTICULARS + """
<h2 id="cancellation">Cancellation by you</h2>
""" + REFUND_RULE + """
<h2>Cancellation by us</h2>
<p>If we cancel, or find we cannot carry out what you bought, we refund what you
  paid for the part not delivered, including the GST charged on it. We pay it to
  the account the money came from, within 45 working days.</p>

<h2>What a fee never covers</h2>
<p>Third-party costs are not ours to refund, because they are not ours to
  collect: university application fees, tuition, deposits, blocked-account fees,
  test fees, visa fees, biometrics, translation, apostille and courier. Where
  one of those is refundable, it is refundable by whoever charged it, on their
  terms.</p>

<h2 id="guarantee-terms">The admission guarantee</h2>
<p>Some packages carry an admission guarantee. It is a promise about our own
  fee, and it is separate from the cancellation rule above — the guarantee pays
  out even though an ordinary cancellation does not.</p>
<p>The exact terms belong to the package you bought, and are set out below.</p>
<div id="pkgTerms" class="pkg-terms"></div>
<p class="legal-note" id="pkgTermsNone" hidden>The terms for each package are
  shown here once they are published. Until then, ask your counsellor for them
  in writing before you buy.</p>

<h2>How a refund reaches you</h2>
<p>Refunds go back to the account the payment came from. We do not pay a refund
  in cash, and we do not pay it to a third party.</p>

<h2>If you disagree with a decision</h2>
<p>Take it to the officer named on the
  <a href="grievance.html">Grievance Redressal</a> page. They must acknowledge
  you within 48 hours and answer within 30 days, and they are not the person who
  made the decision you are disputing.</p>
"""


GRIEVANCE = """
<p class="lead">If something has gone wrong, this is the person whose job it is
  to fix it — not a shared inbox, and not the counsellor you are complaining
  about.</p>
""" + PARTICULARS + """
<h2 id="officer">The grievance officer</h2>
<ul class="legal-particulars" id="officerBox">
  <li data-legal-row="officerName">Name: <b data-legal="officerName"></b></li>
  <li data-legal-row="officerDesignation">Designation:
    <b data-legal="officerDesignation"></b></li>
  <li data-legal-row="officerEmail">Email:
    <a data-legal-href="officerEmail" href="mailto:info@glovels.com"><b
      data-legal="officerEmail"></b></a></li>
  <li data-legal-row="officerPhone">Direct phone:
    <a data-legal-href="officerPhone" href="tel:"><b
      data-legal="officerPhone"></b></a></li>
</ul>
<p id="officerFallback">Until a named officer is published here, write to
  <a href="mailto:info@glovels.com">info@glovels.com</a> and mark the subject
  <b>Grievance</b>. It reaches the same desk.</p>

<h2>How to complain</h2>
<p>Write to the officer above. Tell us who you are, the order reference if you
  have one, what happened and what you want done about it. If you have already
  raised it with your counsellor, say so and when — it saves a round trip.</p>

<h2>What happens then, and when</h2>
<ul>
  <li><b>Within 48 hours</b> we acknowledge you, in writing, with a reference.</li>
  <li><b>Within 30 days</b> we answer: what we found, what we are doing, and if
    we are not doing what you asked, why.</li>
  <li>The officer is not the person who made the decision you are disputing. If
    the complaint is about the officer, address it to a director at the
    registered office above.</li>
</ul>

<h2>What we keep</h2>
<p>We keep a record of every complaint and how it was settled, for as long as we
  are required to and no longer.</p>

<h2>If you are still not satisfied</h2>
<p>You may take a consumer complaint to the National Consumer Helpline on
  <b>1915</b>, or through the consumer commission for your district. Nothing in
  our terms takes that right away, and nothing here has to be exhausted first.</p>
"""


PAGES = {
    "terms.html": TERMS,
    "privacy.html": PRIVACY,
    "refunds.html": REFUNDS,
    "grievance.html": GRIEVANCE,
}


# -------------------------------------------------------------------- the CSS

CSS = """<style>/* GLOVELS-LEGAL-CSS */
.prose h2{margin:34px 0 10px}
.prose .lead{font-size:16.5px;line-height:1.7;color:var(--navy-800)}
.legal-particulars{list-style:none;padding:0;margin:14px 0;display:grid;gap:7px}
.legal-particulars li{font-size:14px;line-height:1.6;color:var(--navy-800);
  padding-left:15px;position:relative}
.legal-particulars li::before{content:"";position:absolute;left:0;top:9px;
  width:5px;height:5px;border-radius:50%;background:var(--gold,#c9a24b)}
.legal-eff{font-size:13.2px;color:var(--muted)}
.legal-note{font-size:13.4px;color:var(--muted);line-height:1.65}
.pkg-terms{display:grid;gap:16px;margin:16px 0 0}
.pkg-term{border:1px solid var(--line);border-radius:12px;padding:17px 19px;
  background:var(--paper)}
.pkg-term > b{display:block;font:700 15.4px/1.35 var(--disp,inherit);
  color:var(--navy-900);margin-bottom:4px}
.pkg-term .pkg-term-price{display:block;font-size:12.4px;color:var(--muted);
  margin-bottom:10px}
.pkg-term h4{margin:14px 0 4px;font-size:13.8px;color:var(--navy-900)}
.pkg-term h4:first-of-type{margin-top:0}
.pkg-term p{margin:0 0 8px;font-size:13.9px;line-height:1.68}
.pkg-term p:last-child{margin-bottom:0}
[data-legal-row]{display:none}
[data-legal-row].on{display:list-item}
p[data-legal-row].on{display:block}
</style>
"""


# ------------------------------------------------------------------ the script

SCRIPT = """<script>/* GLOVELS-LEGAL */
(function () {
  /* Opened from disk there is nothing to fetch, and the page still reads
     correctly without the particulars — which is the whole reason a missing
     value hides its row rather than printing a dash. */
  if (location.protocol === 'file:') return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  fetch('/api/content', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var L = d.legal || {};
      var o = L.officer || {};

      var values = {
        entity: L.entity,
        cin: L.cin,
        gstin: L.gstin,
        address: L.address,
        effective: L.effective,
        jurisdiction: L.jurisdiction,
        officerName: o.name,
        officerDesignation: o.designation,
        officerEmail: o.email,
        officerPhone: o.phone
      };

      Object.keys(values).forEach(function (k) {
        var v = values[k];
        [].forEach.call(document.querySelectorAll('[data-legal="' + k + '"]'),
          function (el) {
            if (!v) return;
            /* An address is typed across several lines and has to stay that
               way — a registered office on one line is not somewhere anybody
               can send a legal notice. */
            if (k === 'address') el.innerHTML = esc(v).replace(/\\n/g, '<br>');
            else el.textContent = v;
          });
        [].forEach.call(document.querySelectorAll('[data-legal-row="' + k + '"]'),
          function (el) { if (v) el.classList.add('on'); });
        [].forEach.call(document.querySelectorAll('[data-legal-href="' + k + '"]'),
          function (el) {
            if (!v) return;
            el.href = (k === 'officerPhone' ? 'tel:' + String(v).replace(/[^0-9+]/g, '')
                                            : 'mailto:' + v);
          });
      });

      /* A named officer replaces the fallback line rather than sitting above
         it — two answers to "who do I write to" is one too many. */
      var fb = document.getElementById('officerFallback');
      if (fb && o.name && o.email) fb.hidden = true;

      /* The package terms, on the refunds page. Each package's own contract,
         under its own name, because that is what the card links here for. */
      var host = document.getElementById('pkgTerms');
      if (!host) return;
      var items = ((d.packages || {}).items || [])
        .filter(function (p) { return p.active !== false && p.terms; });
      var none = document.getElementById('pkgTermsNone');
      if (!items.length) { if (none) none.hidden = false; return; }

      host.innerHTML = items.map(function (p) {
        /* A blank line starts a new clause; a clause whose first line has no
           full stop is its heading. That is how the office types it into the
           box, so that is how it is read back. */
        var body = String(p.terms).split(/\\n\\s*\\n/).map(function (chunk) {
          var lines = chunk.split('\\n').filter(function (x) { return x.trim(); });
          if (!lines.length) return '';
          var head = lines[0].trim();
          if (lines.length > 1 && !/[.:!?]$/.test(head) && head.length < 90) {
            return '<h4>' + esc(head) + '</h4><p>'
                 + esc(lines.slice(1).join(' ')) + '</p>';
          }
          return '<p>' + esc(lines.join(' ')) + '</p>';
        }).join('');

        var price = p.sell && p.priceInr
          ? '<span class="pkg-term-price">' + esc(p.priceFrom || 'From') + ' \\u20b9'
            + Number(p.priceInr).toLocaleString('en-IN') + '</span>'
          : '';
        return '<div class="pkg-term" id="terms-' + esc(p.id) + '"><b>'
             + esc(p.title || p.id) + '</b>' + price + body + '</div>';
      }).join('');
    })
    .catch(function () {});
}());
</script>
"""
