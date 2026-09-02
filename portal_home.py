"""The home page, edited by the people who answer for what it says."""

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

    <div class="out tiles" style="--tiles:4;margin:0 0 18px">
      <div><b id="kPkg">—</b><span>Packages on the site</span></div>
      <div><b id="kFrom">—</b><span>Cheapest package</span></div>
      <div><b id="kLines">—</b><span>Lines of text</span></div>
      <div><b id="kEdited">—</b><span>Reworded</span></div>
    </div>

    <div class="tabs" style="margin-bottom:16px;flex-wrap:wrap">
      <button class="tab" data-t="pkg" aria-selected="true">Packages
        <span class="n" id="nPkg">0</span></button>
      <button class="tab" data-t="num" aria-selected="false">Numbers
        <span class="n" id="nNum">0</span></button>
      <button class="tab" data-t="faq" aria-selected="false">FAQ
        <span class="n" id="nFaq">0</span></button>
      <button class="tab" data-t="sto" aria-selected="false">Stories
        <span class="n" id="nSto">0</span></button>
      <button class="tab" data-t="svc" aria-selected="false">Services
        <span class="n" id="nSvc">0</span></button>
      <button class="tab" data-t="txt" aria-selected="false">Page text
        <span class="n" id="nTxt">0</span></button>
      <button class="tab" data-t="ai" aria-selected="false">SOP &amp; LOR
        <span class="n" id="nAi">0</span></button>
      <button class="tab" data-t="find" aria-selected="false">Finder &amp; contact</button>
      <button class="tab" data-t="legal" aria-selected="false">Legal
        <span class="n" id="nLegal">0</span></button>
      <button class="tab" data-t="sheet" aria-selected="false">Spreadsheet</button>
    </div>

    <!-- -------------------------------------------------------- packages -->
    <section class="pane active" id="t-pkg">
      <div class="p-card" style="margin-bottom:14px;display:flex;gap:11px;flex-wrap:wrap;
        align-items:center">
        <b style="font:700 13.4px/1.4 var(--sans);color:var(--navy-900)">The three tabs on the
          home page</b>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-primary btn-sm" id="addPkg">+ Add a package</button>
      </div>
      <div id="pkgTabs"></div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        <b>The price here is the price charged.</b> The card on the home page, the checkout sheet
        and the receipt all read this one number, so they cannot disagree. <b>Universities
        revealed</b> is the same: it is what the server hands out to a student who has paid, not
        a line of marketing.</p>
    </section>

    <!-- --------------------------------------------------------- numbers -->
    <section class="pane" id="t-num">
      <div class="p-card">
        <h3>The four figures under the hero</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Tick <b>unconfirmed</b> on anything nobody has checked. It puts a DUMMY marker beside it
          on the site, which is ugly on purpose — an unverified student count should not be able
          to ship quietly.</p>
        <div id="numRows"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-add="stats"
          style="margin-top:12px">+ Add a figure</button>
      </div>
    </section>

    <!-- ------------------------------------------------------------- FAQ -->
    <section class="pane" id="t-faq">
      <div class="p-card">
        <h3>The questions everyone asks</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Answer them the way you would on the phone. These are read more than anything else on
          the page.</p>
        <div id="faqRows"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-add="faq"
          style="margin-top:12px">+ Add a question</button>
      </div>
    </section>

    <!-- --------------------------------------------------------- stories -->
    <section class="pane" id="t-sto">
      <div class="p-card">
        <h3>Student stories</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Only put a name here with that student&rsquo;s written consent, and only tick
          <b>verified</b> when the admission letter is on file. Leave <b>unconfirmed</b> ticked
          until both are true.</p>
        <div id="stoRows"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-add="testimonials"
          style="margin-top:12px">+ Add a story</button>
      </div>
    </section>

    <!-- -------------------------------------------------------- services -->
    <section class="pane" id="t-svc">
      <div class="p-card" style="margin-bottom:14px;display:flex;gap:11px;flex-wrap:wrap;
        align-items:center">
        <b style="font:700 13.4px/1.4 var(--sans);color:var(--navy-900)">Everything sold on its
          own &mdash; SOP, LOR, CV, visa, test prep, language, loan</b>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-primary btn-sm" id="addSvc">+ Add a service</button>
      </div>
      <div id="svcCats"></div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        A service can sit in more than one category &mdash; that is how the same card appears
        under <b>Most Booked</b> and under <b>Test Prep</b>. The price here is what the student
        adds to their plan.</p>
    </section>

    <!-- ------------------------------------------------------- page text -->
    <section class="pane" id="t-txt">
      <div class="p-card" style="margin-bottom:14px;display:flex;gap:11px;flex-wrap:wrap;
        align-items:center">
        <input id="tq" placeholder="Search the page for a word or a sentence"
          style="flex:1;min-width:240px;padding:9px 12px;font:400 13px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
        <select id="tsec" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px"></select>
        <label style="display:flex;gap:7px;align-items:center;font:600 12.6px/1.4 var(--sans);
          color:var(--navy-800)">
          <input type="checkbox" id="tonly"> Only what has been changed</label>
      </div>
      <div id="txtRows"></div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        Every word on the home page that is not a package, a figure, an FAQ entry or a story is
        here &mdash; headings, paragraphs, button labels, the words in the enquiry form, the
        footer, and the two lines Google shows. Edit one and it changes on the site as soon as
        the next visitor loads it. <b>Back to original</b> undoes it completely.</p>
    </section>

    <!-- ------------------------------------------------------ spreadsheet -->
    <!-- ---------------------------------------------------- the finder -->
    <section class="pane" id="t-find">
      <div class="p-card" style="margin-bottom:14px">
        <h3>Public university names</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          The finder matches a visitor to public universities whether or not they have paid.
          This decides how much of each one they are shown &mdash; and it is the single
          biggest lever on the site, so it is worth being deliberate about.</p>
        <div class="field" style="margin-bottom:0;max-width:520px">
          <label for="fGate">What a visitor who has not paid sees</label>
          <select id="fGate">
            <option value="gated">The match, not the name &mdash; the name comes with a package</option>
            <option value="names">The name, but not the fee</option>
            <option value="open">Everything &mdash; names and fees, free to all</option>
          </select>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>How much a visitor sees before they pay</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Somebody who lands on the site and has not touched the filters sees this many
          universities. It is a pricing decision, not a layout one &mdash; too few and the
          finder looks empty, too many and there is less reason to buy a package.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <div class="field" style="margin-bottom:10px">
            <label for="fBrowsePub">Public universities shown</label>
            <input id="fBrowsePub" type="number" min="1" max="50"></div>
          <div class="field" style="margin-bottom:10px">
            <label for="fBrowsePriv">Private universities shown</label>
            <input id="fBrowsePriv" type="number" min="1" max="50"></div>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>The CGPA bar</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Used only for a destination that has not set its own on the Catalogue screen.
          On 10.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <div class="field" style="margin-bottom:10px">
            <label for="fCgFull">Public universities</label>
            <input id="fCgFull" type="number" min="0" max="10" step="0.1"></div>
          <div class="field" style="margin-bottom:10px">
            <label for="fCgPart">Private universities</label>
            <input id="fCgPart" type="number" min="0" max="10" step="0.1"></div>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>Budget bands</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          The buckets on the finder. A programme lands in a band by its total tuition, so the
          ceilings decide what appears where. Leave the last one&rsquo;s ceiling empty &mdash;
          that is what makes it the top band rather than a bucket that matches nothing.</p>
        <div id="bandRows"></div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>Trending fields</h3>
        <p style="margin:0 0 12px;font-size:12.8px;color:var(--muted);line-height:1.6">
          The suggestion chips. One per line. They have to match a field on the programmes
          exactly, or the chip finds nothing.</p>
        <textarea id="fTrend" rows="7" style="width:100%;padding:10px 12px;
          font:400 13px/1.7 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;
          resize:vertical"></textarea>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>What a currency is worth</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Rupees for one unit. Used by the currency switch beside the results &mdash; the fees
          themselves are stored in rupees and converted for display.</p>
        <div id="fxRows" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
          gap:0 14px"></div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>The words on the service badges</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          You pick which badge a service carries on the Services tab. These are what those
          badges say.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0 14px">
          <div class="field" style="margin-bottom:10px"><label for="fbBest">Bestseller</label>
            <input id="fbBest"></div>
          <div class="field" style="margin-bottom:10px"><label for="fbValue">Best value</label>
            <input id="fbValue"></div>
          <div class="field" style="margin-bottom:10px"><label for="fbFast">Fast</label>
            <input id="fbFast"></div>
          <div class="field" style="margin-bottom:10px"><label for="fbStart">Start here</label>
            <input id="fbStart"></div>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>How people reach you</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          These are the <b>links</b> on every page &mdash; the WhatsApp button, the phone link,
          the email link. The number as it is <em>written</em> on the page is a line of text and
          is edited on the Page text tab; change it in both places or they will disagree, and
          the one people read is not the one that dials.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 14px">
          <div class="field" style="margin-bottom:10px">
            <label for="fWa">WhatsApp number</label>
            <input id="fWa" placeholder="917093314089">
            <span style="display:block;margin-top:4px;font-size:11.6px;color:var(--muted)">
              Country code, no plus, no spaces.</span></div>
          <div class="field" style="margin-bottom:10px">
            <label for="fPhone">Phone</label><input id="fPhone" placeholder="+91 70933 14089"></div>
          <div class="field" style="margin-bottom:10px">
            <label for="fEmail">Email</label><input id="fEmail" placeholder="info@glovels.com"></div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary" id="findSave">Save</button>
        <span id="findWhen" style="font:600 12.2px/1.4 var(--sans);color:var(--muted)"></span>
      </div>
    </section>

    <!-- ---------------------------------------------------- the studio -->
    <section class="pane" id="t-ai">
      <div class="p-card" style="margin-bottom:14px">
        <h3>What the SOP and LOR studio writes</h3>
        <p style="margin:0 0 6px;font-size:12.8px;color:var(--muted);line-height:1.6">
          A draft is built from these sentences and nothing else. Each list is a set of
          alternatives &mdash; the studio uses a different one each time a student presses
          <b>write it again</b>, so a list with one line in it means every draft opens the
          same way.</p>
        <p style="margin:0;font-size:12.8px;color:var(--muted);line-height:1.6">
          The words in braces are filled in from what the student typed:
          <code>{programme}</code>, <code>{university}</code>, <code>{signals}</code>,
          <code>{motives}</code>, <code>{who}</code>, <code>{span}</code>,
          <code>{instance}</code>. A sentence whose value is missing is left out of that
          draft rather than printed with a gap in it, so it is safe to write one that
          uses <code>{instance}</code> even though not every student fills that box in.</p>
      </div>

      <div class="p-card" style="margin-bottom:14px;border-color:#e0d3a8;background:#fffdf6">
        <b style="font:700 13px/1.5 var(--sans);color:#7a5510">Nothing here may state a fact
          about the student.</b>
        <p style="margin:6px 0 0;font-size:12.8px;color:var(--muted);line-height:1.6">
          No grade, rank, title, employer or publication &mdash; not even a flattering one.
          Every concrete detail in a finished draft has to have come from a box the student
          filled in, because they are signing it and a university is reading it. Sentences
          about emphasis are fine; sentences that claim an achievement are not.</p>
      </div>

      <div class="tabs" style="margin-bottom:14px">
        <button class="tab tab-ai" data-a="sop" aria-selected="true">Statement of Purpose</button>
        <button class="tab tab-ai" data-a="lor" aria-selected="false">Letter of Recommendation</button>
      </div>

      <div id="aiPanes"></div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px">
        <button type="button" class="btn btn-primary" id="aiSave">Save the writing</button>
        <button type="button" class="btn btn-ghost" id="aiPreview">Show me a draft</button>
        <span id="aiWhen" style="font:600 12.2px/1.4 var(--sans);color:var(--muted)"></span>
      </div>
      <div id="aiPrev" style="margin-top:16px"></div>
    </section>

    <!-- ------------------------------------------------------------ legal -->
    <section class="pane" id="t-legal">
      <div class="p-card" style="margin-bottom:14px">
        <h3>What is still missing</h3>
        <p style="margin:0 0 12px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Terms of Use, the Privacy Policy, the Refund policy and the Grievance page all quote
          the same particulars, and they read them from here &mdash; so a wrong digit is fixed
          once, not four times. A field left blank does not print a dash on the public page;
          its whole line is left out. This is the only place that says so.</p>
        <div id="legalGaps"></div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>The company</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
          gap:0 14px">
          <div class="field" style="margin-bottom:10px"><label for="lgEntity">Legal entity
            name</label><input id="lgEntity" placeholder="Glovels Consultants Private Limited">
            <p style="margin:5px 0 0;font-size:11.4px;color:var(--muted);line-height:1.5">
              Must match the PAN and GST records character for character.</p></div>
          <div class="field" style="margin-bottom:10px"><label for="lgCin">CIN</label>
            <input id="lgCin" placeholder="U80903TG2019PTC000000"></div>
          <div class="field" style="margin-bottom:10px"><label for="lgGstin">GSTIN</label>
            <input id="lgGstin" placeholder="36AAAAA0000A1Z5"></div>
          <div class="field" style="margin-bottom:10px"><label for="lgJuris">Courts of</label>
            <input id="lgJuris" placeholder="Hyderabad, Telangana"></div>
        </div>
        <div class="field" style="margin-bottom:10px"><label for="lgAddress">Registered office
          address</label>
          <textarea id="lgAddress" rows="3"
            placeholder="Line by line, exactly as on the incorporation certificate"></textarea>
          <p style="margin:5px 0 0;font-size:11.4px;color:var(--muted);line-height:1.5">
            Line breaks are kept. An address on one line is not somewhere anybody can send a
            legal notice.</p></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
          gap:0 14px">
          <div class="field" style="margin-bottom:10px"><label for="lgEffective">In effect
            from</label><input id="lgEffective" placeholder="1 September 2026">
            <p style="margin:5px 0 0;font-size:11.4px;color:var(--muted);line-height:1.5">
              Until this is set, the pages simply do not show an effective date.</p></div>
          <div class="field" style="margin-bottom:10px"><label for="lgInvoice">Invoice
            numbering series</label><input id="lgInvoice" placeholder="GLV/26-27/0001"></div>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>The grievance officer</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          The Consumer Protection (E-Commerce) Rules want a named person with a direct number.
          A shared inbox does not satisfy it. Until a name and an email are here, the Grievance
          page tells people to write to <code>info@glovels.com</code> instead &mdash; which
          works, but is not what the rules ask for.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
          gap:0 14px">
          <div class="field" style="margin-bottom:10px"><label for="lgOffName">Name</label>
            <input id="lgOffName" placeholder="Kavya Menon"></div>
          <div class="field" style="margin-bottom:10px"><label for="lgOffRole">Designation</label>
            <input id="lgOffRole" placeholder="Grievance Officer"></div>
          <div class="field" style="margin-bottom:10px"><label for="lgOffMail">Email</label>
            <input id="lgOffMail" inputmode="email" placeholder="grievance@glovels.com"></div>
          <div class="field" style="margin-bottom:10px"><label for="lgOffPhone">Direct
            phone</label><input id="lgOffPhone" inputmode="tel" placeholder="+91 40 0000 0000">
            </div>
        </div>
      </div>

      <div class="p-card" style="margin-bottom:14px">
        <h3>The terms behind each package</h3>
        <p style="margin:0 0 6px;font-size:12.8px;color:var(--muted);line-height:1.6">
          The pledge on a card is one sentence; this is the contract behind it, and it is what
          <b>Full terms</b> on the card opens. Each package has its own, because they are not
          the same promise.</p>
        <p style="margin:0 0 14px;font-size:12.2px;color:var(--muted);line-height:1.6">
          Type it as clauses separated by a blank line. A first line with no full stop becomes
          that clause's heading. Nothing else is interpreted.</p>
        <div id="legalTerms"></div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary" id="lgSave">Save the legal details</button>
        <span id="lgSaved" class="st ok" hidden>Saved</span>
      </div>
    </section>

    <section class="pane" id="t-sheet">
      <div class="p-card" style="margin-bottom:14px">
        <h3>Download</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          One sheet per section. Edit it in Excel and upload it below.</p>
        <div id="dlRows" style="display:grid;gap:10px"></div>
      </div>

      <div class="p-card">
        <h3>Upload</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Nothing is written when you upload. You are shown exactly what the file would do, and
          it is applied only when you press the button under that summary.</p>
        <div style="display:flex;gap:11px;flex-wrap:wrap;align-items:center">
          <select id="sWhat" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
            border:1.5px solid #d8dde4;border-radius:9px"></select>
          <input type="file" id="sFile" accept=".xlsx,.csv"
            style="font:400 13px/1.4 var(--sans);max-width:100%">
          <button type="button" class="btn btn-primary btn-sm" id="sCheck">Check the file</button>
          <span id="sBusy" style="display:none;font:600 12.4px/1.4 var(--sans);color:var(--muted)">
            Reading&hellip;</span>
        </div>
        <div id="sOut" style="margin-top:18px"></div>
      </div>
    </section>

    <div class="modal" id="svcModal" role="dialog" aria-modal="true">
      <div class="sheet" style="width:min(720px,100%)">
        <button class="sheet-close" data-sclose aria-label="Close">✕</button>
        <h3 id="smTitle">Add a service</h3>
        <p class="lead">It is on the home page as soon as you save.</p>
        <div id="smBody"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="smSave">Save</button>
          <button type="button" class="btn btn-ghost" data-sclose>Cancel</button>
          <button type="button" class="btn btn-ghost" id="smDelete" style="margin-left:auto">Remove</button>
        </div>
        <p id="smErr" role="alert" style="display:none;margin:14px 0 0;padding:11px 13px;
          border-radius:10px;font:600 12.8px/1.5 var(--sans);background:#fdf3f2;
          border:1px solid #f0c8c4;color:#7a2118"></p>
      </div>
    </div>

    <!-- ------------------------------------------------------ the editor -->
    <div class="modal" id="pkgModal" role="dialog" aria-modal="true">
      <div class="sheet" style="width:min(760px,100%)">
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <h3 id="pmTitle">Add a package</h3>
        <p class="lead" id="pmLead">It is on the home page as soon as you save.</p>
        <div id="pmBody"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="pmSave">Save</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="button" class="btn btn-ghost" id="pmDelete" style="margin-left:auto">Remove</button>
        </div>
        <p id="pmErr" role="alert" style="display:none;margin:14px 0 0;padding:11px 13px;
          border-radius:10px;font:600 12.8px/1.5 var(--sans);background:#fdf3f2;
          border:1px solid #f0c8c4;color:#7a2118"></p>
      </div>
    </div>
"""

SCRIPT = r"""
let C = null, TEXT = null, editing = null;

const inr = n => '₹' + new Intl.NumberFormat('en-IN').format(Number(n || 0));
const BLOCKS = [['packages', 'Packages'], ['services', 'Services'],
  ['stats', 'Numbers'], ['faq', 'FAQ'], ['testimonials', 'Stories'],
  ['text', 'Page text']];

const BADGES = [['', 'No badge'], ['best', 'Bestseller'], ['start', 'Start here'],
  ['fast', 'Fast'], ['value', 'Best value']];

/* ---------------------------------------------------------------- painting */

function paintPackages() {
  const pk = C.packages;
  $('#nPkg').textContent = pk.items.length;
  $('#kPkg').textContent = pk.items.filter(p => p.active !== false).length;
  const prices = pk.items.filter(p => p.sell && p.active !== false).map(p => p.priceInr);
  $('#kFrom').textContent = prices.length ? inr(Math.min.apply(null, prices)) : '—';

  $('#pkgTabs').innerHTML = pk.tabs.map(t => {
    const rows = pk.items.filter(p => p.tab === t.key);
    return '<div class="p-card" style="padding:0;margin-bottom:14px;overflow-x:auto">' +
      '<div style="padding:14px 16px 0"><b style="font:700 13.4px/1.4 var(--sans)">' +
        esc(t.label) + '</b> <span style="font-size:12px;color:var(--muted)">' +
        rows.length + ' package' + (rows.length === 1 ? '' : 's') + '</span></div>' +
      '<table class="tbl" style="margin:8px 0 0"><thead><tr><th>Package</th><th>Price</th>' +
        '<th>Reveals</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows.map(p =>
        '<tr><td><b>' + esc(p.title) + '</b>' +
          (p.ribbon ? ' <span class="st ok">' + esc(p.ribbon) + '</span>' : '') +
          '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc(p.desc.slice(0, 90)) + '</span></td>' +
        '<td>' + (p.sell ? '<b>' + inr(p.priceInr) + '</b>' +
            (p.priceNote ? '<br><span style="font-size:11.4px;color:var(--muted)">' +
              esc(p.priceNote) + '</span>' : '')
          : '<span class="st none">On request</span>') + '</td>' +
        '<td>' + (p.unlocks ? p.unlocks + ' universities' : '—') + '</td>' +
        '<td>' + (p.active === false ? '<span class="st wait">Hidden</span>'
                                     : '<span class="st ok">On the site</span>') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-move="' + esc(p.id) +
            '" data-dir="-1" style="margin-left:6px" aria-label="Move up">↑</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-move="' + esc(p.id) +
            '" data-dir="1" style="margin-left:4px" aria-label="Move down">↓</button>' +
        '</td></tr>').join('') ||
        '<tr><td colspan="5" style="padding:18px;color:var(--muted)">Nothing in this tab yet.</td></tr>') +
      '</tbody></table></div>';
  }).join('');
}

/* The three simple lists share one editor: a card of fields per row, saved as a
   whole block. They are short enough that a row-at-a-time API would be more
   moving parts for no benefit. */

function rowCard(n, fields, count) {
  return '<div class="p-card" style="padding:14px 16px;margin-bottom:10px;background:var(--paper)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<b style="font:700 12.6px/1 var(--sans);color:var(--muted);letter-spacing:.08em;' +
        'text-transform:uppercase">' + (n + 1) + ' of ' + count + '</b>' +
      '<span><button type="button" class="btn btn-ghost btn-sm" data-rmove="' + n +
        '" data-dir="-1" aria-label="Move up">↑</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-rmove="' + n +
        '" data-dir="1" style="margin-left:4px" aria-label="Move down">↓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-rdel="' + n +
        '" style="margin-left:8px">Remove</button></span>' +
    '</div>' + fields + '</div>';
}

const tf = (label, id, value, ph, wide, num) =>
  '<div class="field" style="margin-bottom:10px' + (wide ? ';grid-column:1/-1' : '') + '">' +
  '<label for="' + id + '">' + esc(label) + '</label>' +
  '<input id="' + id + '" value="' + esc(value == null ? '' : value) + '"' +
  (num ? ' type="number" min="0" step="1" inputmode="numeric"' : '') +
  (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';

const ta = (label, id, value, wide) =>
  '<div class="field" style="margin-bottom:10px' + (wide ? ';grid-column:1/-1' : '') + '">' +
  '<label for="' + id + '">' + esc(label) + '</label>' +
  '<textarea id="' + id + '" rows="3" style="width:100%;padding:9px 11px;font:400 13px/1.5 ' +
  'var(--sans);border:1.5px solid #d8dde4;border-radius:9px;resize:vertical">' +
  esc(value == null ? '' : value) + '</textarea></div>';

const tick = (label, id, on) =>
  '<label style="display:flex;gap:8px;align-items:center;font:600 12.6px/1.4 var(--sans);' +
  'color:var(--navy-800);margin:2px 0 10px"><input type="checkbox" id="' + id + '"' +
  (on ? ' checked' : '') + '> ' + esc(label) + '</label>';

function paintStats() {
  $('#nNum').textContent = C.stats.length;
  $('#numRows').innerHTML = C.stats.map((s, n) => rowCard(n,
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:0 14px">' +
      tf('The figure', 'num' + n, s.num, '3,200+') +
      tf('What it counts', 'lbl' + n, s.label, 'students placed abroad') +
    '</div>' + tick('Unconfirmed — show a DUMMY marker beside it', 'sd' + n, s.dummy),
    C.stats.length)).join('');
}

function paintFaq() {
  $('#nFaq').textContent = C.faq.length;
  $('#faqRows').innerHTML = C.faq.map((f, n) => rowCard(n,
    tf('Question', 'q' + n, f.q, 'Can I study abroad for free?') +
    ta('Answer', 'a' + n, f.a) +
    tick('Unconfirmed — show a DUMMY marker beside it', 'fd' + n, f.dummy),
    C.faq.length)).join('');
}

function paintStories() {
  $('#nSto').textContent = C.testimonials.length;
  $('#stoRows').innerHTML = C.testimonials.map((t, n) => rowCard(n,
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      tf('Initials', 'tn' + n, t.name, 'R.K.') +
      tf('Route', 'tr' + n, t.route, 'India → Germany') +
      tf('Where they are', 'tw' + n, t.where, 'Public university · Germany') +
      tf('Intake', 'ti' + n, t.intake, 'Winter 2026') +
    '</div>' + ta('What they say', 'tq' + n, t.quote, true) +
    tick('Verified — the admission letter is on file', 'tv' + n, t.verified) +
    tick('Unconfirmed — show a DUMMY marker beside it', 'td' + n, t.dummy),
    C.testimonials.length)).join('');
}

/* ------------------------------------------------------------------ services */

let editingSvc = null;

function paintServices() {
  const sv = C.services || {tabs: [], items: []};
  $('#nSvc').textContent = sv.items.length;

  /* Grouped by the chips the visitor sees. A service in two categories is
     listed twice on purpose — that is what it does on the page, and hiding
     the duplication here would make "why is this under Test Prep?" unanswerable. */
  $('#svcCats').innerHTML = sv.tabs.map(t => {
    const rows = sv.items.filter(x => (x.cats || []).indexOf(t.key) >= 0);
    return '<div class="p-card" style="padding:0;margin-bottom:14px;overflow-x:auto">' +
      '<div style="padding:14px 16px 0"><b style="font:700 13.4px/1.4 var(--sans)">' +
        esc(t.label) + '</b> <span style="font-size:12px;color:var(--muted)">' +
        rows.length + '</span></div>' +
      '<table class="tbl" style="margin:8px 0 0"><thead><tr><th>Service</th><th>Price</th>' +
        '<th>How long</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows.map(x =>
        '<tr><td><b>' + esc(x.name) + '</b>' +
          (x.badge ? ' <span class="st ok">' +
            esc((BADGES.find(b => b[0] === x.badge) || ['', ''])[1]) + '</span>' : '') +
          (x.ai ? ' <span class="st none">AI draft</span>' : '') +
          '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc((x.desc || '').slice(0, 90)) + '</span></td>' +
        '<td>' + (x.isFree ? '<span class="st ok">Free</span>'
          : x.priceLabel ? esc(x.priceLabel)
          : '<b>' + inr(x.priceInr) + '</b>') + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc(x.meta || '—') + '</td>' +
        '<td>' + (x.active === false ? '<span class="st wait">Hidden</span>'
                                     : '<span class="st ok">On the site</span>') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-sedit="' + esc(x.id) +
            '">Edit</button></td></tr>').join('') ||
        '<tr><td colspan="5" style="padding:18px;color:var(--muted)">Nothing in this ' +
        'category yet.</td></tr>') +
      '</tbody></table></div>';
  }).join('');

  /* A service in no category at all never renders on the page. Silently
     dropping it from this screen too would make it unfindable. */
  const orphans = sv.items.filter(x => !(x.cats || []).length);
  if (orphans.length) {
    $('#svcCats').insertAdjacentHTML('beforeend',
      '<div class="p-card" style="padding:0;overflow-x:auto;border-color:#f0dcb4">' +
      '<div style="padding:14px 16px 0;color:#7a5510"><b style="font:700 13.4px/1.4 var(--sans)">' +
      'In no category &mdash; not shown anywhere on the page</b></div>' +
      '<table class="tbl" style="margin:8px 0 0"><tbody>' +
      orphans.map(x => '<tr><td><b>' + esc(x.name) + '</b></td>' +
        '<td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" ' +
        'data-sedit="' + esc(x.id) + '">Edit</button></td></tr>').join('') +
      '</tbody></table></div>');
  }
}

function openService(x) {
  editingSvc = x || null;
  const v = x || {active: true, cats: ['top'], isFree: false, priceInr: 599};
  const sv = C.services || {tabs: []};
  $('#smTitle').textContent = x ? 'Edit service' : 'Add a service';
  $('#smDelete').style.display = x ? '' : 'none';
  $('#smErr').style.display = 'none';

  const sel = (label, id, value, opts, help) =>
    '<div class="field" style="margin-bottom:10px"><label for="' + id + '">' + esc(label) +
    '</label><select id="' + id + '">' + opts.map(([o, t]) =>
      '<option value="' + esc(o) + '"' + (String(o) === String(value) ? ' selected' : '') +
      '>' + esc(t) + '</option>').join('') + '</select>' +
    (help ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted);line-height:1.5">' +
      help + '</p>' : '') + '</div>';

  $('#smBody').innerHTML =
    tf('Name', 'sName', v.name, 'SOP Development & Editing') +
    ta('The line under the name', 'sDesc', v.desc, true) +
    tf('How long it takes', 'sMeta', v.meta, 'AI draft in ~60s · final in 1 business day') +
    '<h3 style="font-size:14px;margin:14px 0 4px">Where it appears</h3>' +
    '<p style="margin:0 0 10px;font-size:11.8px;color:var(--muted);line-height:1.5">' +
      'Tick every category it belongs in. A service with none is not shown at all.</p>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-bottom:10px">' +
    (sv.tabs || []).map(t =>
      '<label style="display:flex;gap:8px;align-items:center;font:600 12.8px/1.4 var(--sans);' +
      'color:var(--navy-800);margin-bottom:7px"><input type="checkbox" id="sCat_' + t.key + '"' +
      ((v.cats || []).indexOf(t.key) >= 0 ? ' checked' : '') + '> ' + esc(t.label) +
      '</label>').join('') +
    '</div>' +
    '<h3 style="font-size:14px;margin:14px 0 10px">Price</h3>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      sel('How it is priced', 'sFree', v.isFree ? '1' : '0',
        [['0', 'A price'], ['1', 'Free']]) +
      tf('Price, ₹', 'sPrice', v.priceInr || 0, '599') +
      tf('Instead of a price', 'sPriceLabel', v.priceLabel, 'Priced per case') +
      sel('Badge', 'sBadge', v.badge, BADGES) +
      tf('Button label', 'sCta', v.ctaLabel, 'Book my free session') +
      tf('Button link', 'sHref', v.ctaHref, '#counsel') +
    '</div>' +
    '<p style="margin:2px 0 10px;font-size:11.6px;color:var(--muted);line-height:1.5">' +
      'Leave the button label empty and the card gets the ordinary ' +
      '<b>Add to plan</b> button. Fill it in and it becomes a link instead &mdash; that is ' +
      'how &ldquo;Book my free session&rdquo; sends people to the enquiry form.</p>' +
    tick('Show this on the website', 'sActive', v.active !== false);

  $('#svcModal').classList.add('on');
  setTimeout(() => $('#sName').focus(), 50);
}

function readService() {
  const sv = C.services || {tabs: []};
  const free = $('#sFree').value === '1';
  return Object.assign({}, editingSvc || {}, {
    id: editingSvc ? editingSvc.id : '',
    name: $('#sName').value,
    desc: $('#sDesc').value,
    meta: $('#sMeta').value,
    cats: (sv.tabs || []).map(t => t.key).filter(k => $('#sCat_' + k).checked),
    isFree: free,
    priceInr: free ? 0 : Number($('#sPrice').value || 0),
    priceLabel: $('#sPriceLabel').value,
    badge: $('#sBadge').value,
    ctaLabel: $('#sCta').value,
    ctaHref: $('#sHref').value,
    active: $('#sActive').checked,
  });
}

const saveServices = items =>
  api('PUT', '/api/staff/content/services',
    {value: Object.assign({}, C.services, {items})});

function paintText() {
  const lines = TEXT.lines;
  $('#nTxt').textContent = lines.length;
  $('#kLines').textContent = lines.length;
  $('#kEdited').textContent = TEXT.edited;

  /* A section name a person recognises. Most sections are named by their own
     heading; the three that have no heading are the ones everybody thinks of
     by where they are on the screen. */
  const SECTION_NAME = {
    page: 'Menu, and words that are not in a section',
    header: 'The top of the page',
    footer: 'The footer',
  };
  const nameOf = l => SECTION_NAME[l.section] || l.sectionLabel
    || l.section.replace(/^section-/, 'Section ');

  const secs = [];
  lines.forEach(l => {
    if (!secs.some(s => s.key === l.section)) {
      secs.push({key: l.section, label: nameOf(l)});
    }
  });
  const keep = $('#tsec').value;
  $('#tsec').innerHTML = '<option value="">Every part of the page</option>' +
    secs.map(s => '<option value="' + esc(s.key) + '">' + esc(s.label) + '</option>').join('');
  $('#tsec').value = keep;

  const q = $('#tq').value.trim().toLowerCase();
  const sec = $('#tsec').value;
  const only = $('#tonly').checked;
  const show = lines.filter(l =>
    (!sec || l.section === sec) &&
    (!only || l.edited) &&
    (!q || (l.current + ' ' + l.original).toLowerCase().includes(q)));

  const where = l => l.kind === 'title' ? 'Page title (Google)'
    : l.kind === 'meta-description' ? 'Search description (Google)'
    : l.kind.indexOf('attr:') === 0 ? l.kind.slice(5)
    : ({h1: 'Big heading', h2: 'Heading', h3: 'Sub-heading', p: 'Paragraph',
        a: 'Link', button: 'Button', li: 'List item', b: 'Bold text',
        summary: 'Question', label: 'Form label', small: 'Small print',
        span: 'Text', div: 'Text'}[l.element] || l.element);

  let last = '';
  $('#txtRows').innerHTML = show.slice(0, 250).map(l => {
    let head = '';
    if (l.section !== last) {
      last = l.section;
      const label = (secs.find(s => s.key === l.section) || {}).label || nameOf(l);
      head = '<h3 style="font-size:13.6px;margin:18px 0 8px">' + esc(label) + '</h3>';
    }
    return head +
      '<div class="p-card" style="padding:12px 15px;margin-bottom:8px;display:grid;' +
        'grid-template-columns:120px 1fr auto;gap:12px;align-items:start">' +
      '<span class="st none" style="text-transform:none;letter-spacing:0;margin-top:6px">' +
        esc(where(l)) + '</span>' +
      '<div><textarea data-tkey="' + esc(l.key) + '" rows="' +
        (l.current.length > 110 ? 3 : 1) + '" style="width:100%;padding:8px 10px;' +
        'font:400 13px/1.5 var(--sans);border:1.5px solid ' +
        (l.edited ? 'var(--gold-soft,#c9a227)' : '#d8dde4') +
        ';border-radius:9px;resize:vertical">' + esc(l.current) + '</textarea>' +
        (l.edited ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted);' +
          'line-height:1.5">Was: ' + esc(l.original) + '</p>' : '') +
        (l.note ? '<p style="margin:5px 0 0;font-size:11.4px;color:var(--muted)">' +
          esc(l.note) + '</p>' : '') +
      '</div>' +
      '<span style="white-space:nowrap">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-tsave="' + esc(l.key) +
          '">Save</button>' +
        (l.edited ? '<button type="button" class="btn btn-ghost btn-sm" data-treset="' +
          esc(l.key) + '" style="margin-left:6px">Back to original</button>' : '') +
      '</span></div>';
  }).join('') || '<div class="sl-empty"><b>Nothing matches</b><p>Try a different word.</p></div>';

  if (show.length > 250) {
    $('#txtRows').insertAdjacentHTML('beforeend',
      '<p style="margin:12px 0 0;font-size:12.4px;color:var(--muted)">Showing the first 250 of ' +
      show.length + ' — search to narrow it down.</p>');
  }

  if (TEXT.orphans && TEXT.orphans.length) {
    $('#txtRows').insertAdjacentHTML('afterbegin',
      '<div class="p-card" style="padding:13px 15px;margin-bottom:12px;background:#fffaf0;' +
      'border:1px solid #f0dcb4"><b style="font:700 13px/1.4 var(--sans);color:#7a5510">' +
      TEXT.orphans.length + ' earlier edit' + (TEXT.orphans.length === 1 ? '' : 's') +
      ' no longer match anything on the page.</b>' +
      '<p style="margin:6px 0 0;font-size:12.4px;color:#7a5510;line-height:1.55">The line ' +
      'they replaced was reworded when the site was last rebuilt, so they are not being ' +
      'applied. Nothing is broken — but if the wording mattered, make the change again ' +
      'below.</p></div>');
  }
}

function paintSheet() {
  $('#dlRows').innerHTML = BLOCKS.map(([k, label]) =>
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
    '<b style="min-width:120px;font:700 13px/1.4 var(--sans)">' + esc(label) + '</b>' +
    '<a class="btn btn-ghost btn-sm" href="/api/staff/content/' + k + '.xlsx">Excel</a>' +
    '<a class="btn btn-ghost btn-sm" href="/api/staff/content/' + k + '.csv">CSV</a></div>').join('');
  if (!$('#sWhat').options.length) {
    $('#sWhat').innerHTML = BLOCKS.map(([k, label]) =>
      '<option value="' + k + '">' + esc(label) + '</option>').join('');
  }
}

/* ----------------------------------------------------------------- the finder */

const FX_ORDER = ['EUR', 'USD', 'GBP', 'AUD', 'CAD'];

function paintFinder() {
  const f = C.finder;
  if (!f) return;
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v == null ? '' : v; };
  set('fBrowsePub', f.browsePublic);
  set('fBrowsePriv', f.browsePrivate);
  set('fCgFull', f.cgpaFull);
  set('fCgPart', f.cgpaPartial);
  set('fTrend', (f.trending || []).join('\n'));
  set('fGate', f.gate || 'gated');
  set('fbBest', (f.badges || {}).best);
  set('fbValue', (f.badges || {}).value);
  set('fbFast', (f.badges || {}).fast);
  set('fbStart', (f.badges || {}).start);
  set('fWa', (f.contact || {}).whatsapp);
  set('fPhone', (f.contact || {}).phone);
  set('fEmail', (f.contact || {}).email);

  $('#bandRows').innerHTML = (f.bands || []).map((b, n) =>
    '<div style="display:grid;grid-template-columns:1fr 200px;gap:0 14px;align-items:end">' +
      tf('Label', 'bl' + n, b.label, 'Under \u20b910L') +
      tf('Ceiling, \u20b9 (blank = no ceiling)', 'bc' + n,
        b.ceilInr == null ? '' : b.ceilInr, '1000000') +
    '</div>' +
    '<p class="bandRange" data-n="' + n + '" style="margin:-4px 0 14px;font:600 12.2px/1.5 ' +
      'var(--sans);color:var(--muted)"></p>').join('');
  paintBandRanges();

  $('#fxRows').innerHTML = FX_ORDER.map(code =>
    tf(code + ' \u2192 \u20b9', 'fx' + code, (f.fx || {})[code] || '')).join('');

  const meta = C.updated && C.updated.finder;
  $('#findWhen').textContent = meta
    ? 'Last changed by ' + meta.who + ' ' + timeAgo(meta.updated_at) : '';
}

function finderFromScreen() {
  const v = id => { const el = $('#' + id); return el ? el.value.trim() : ''; };
  const fx = {};
  FX_ORDER.forEach(c => { if (v('fx' + c)) fx[c] = Number(v('fx' + c)); });
  return {
    browsePublic: Number(v('fBrowsePub')) || C.finder.browsePublic,
    browsePrivate: Number(v('fBrowsePriv')) || C.finder.browsePrivate,
    cgpaFull: Number(v('fCgFull')) || C.finder.cgpaFull,
    cgpaPartial: Number(v('fCgPart')) || C.finder.cgpaPartial,
    fx,
    bands: (C.finder.bands || []).map((b, n) => ({
      id: b.id,
      label: v('bl' + n) || b.label,
      /* An empty ceiling is a real value here — it means "no ceiling", which is
         what makes the last band the top one. Number('') is 0, and a band with
         a ceiling of zero matches nothing at all. */
      ceilInr: v('bc' + n) === '' ? null : Number(v('bc' + n)),
    })),
    trending: v('fTrend').split('\n').map(x => x.trim()).filter(Boolean),
    gate: v('fGate') || C.finder.gate,
    badges: {
      best: v('fbBest'), value: v('fbValue'), fast: v('fbFast'), start: v('fbStart'),
    },
    contact: { whatsapp: v('fWa'), phone: v('fPhone'), email: v('fEmail') },
  };
}

document.addEventListener('click', async e => {
  if (!e.target.closest('#findSave')) return;
  const btn = e.target.closest('#findSave');
  btn.disabled = true;
  try {
    const r = await api('PUT', '/api/staff/content/finder', {value: finderFromScreen()});
    C.finder = r.saved;
    await reload();
    toast('Saved — the next visitor gets this.');
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

/* ---------------------------------------------------------------- the studio */

let aiKind = 'sop';

/* The four or five sentence lists, plus the chips. One textarea per list, one
   line per sentence: a sentence is a paragraph in a draft, so a blank line
   between them would be ambiguous and a row-per-sentence editor would be five
   screens tall for something people edit twice a year. */
const AI_LISTS = {
  sop: [
    ['openings', 'How it opens', 'The first paragraph. It names the programme and the university.'],
    ['background', 'What they have done', 'Carries {signals} — the things the student ticked.'],
    ['motive', 'Why this course', 'Carries {motives}. Left out when nothing is ticked.'],
    ['fit', 'Why this university', 'No placeholders needed; {programme} and {university} are available.'],
    ['closings', 'How it ends', 'The last paragraph.'],
  ],
  lor: [
    ['openings', 'How it opens', 'Carries {who} and {span} — who is writing and for how long.'],
    ['body', 'What they saw', 'Carries {signals}.'],
    ['instance', 'The specific example', 'Carries {instance}. Left out when the student leaves that box empty.'],
    ['closings', 'How it ends', 'The last paragraph.'],
  ],
};

function paintAi() {
  if (!C.writing) return;
  const w = C.writing[aiKind] || {};
  const n = (C.writing.sop.openings || []).length + (C.writing.lor.openings || []).length;
  $('#nAi').textContent = n;

  const box = (key, label, hint) => {
    const lines = (w[key] || []).join('\n');
    return '<div class="p-card" style="margin-bottom:10px">' +
      '<label for="ai_' + key + '" style="display:block;font:700 13.4px/1.4 var(--sans);' +
        'color:var(--navy-900);margin-bottom:3px">' + esc(label) +
        ' <span style="font-weight:600;color:var(--muted)">(' + (w[key] || []).length + ')</span></label>' +
      '<p style="margin:0 0 9px;font-size:12.2px;color:var(--muted);line-height:1.5">' +
        esc(hint) + ' One per line.</p>' +
      '<textarea id="ai_' + key + '" rows="' + Math.min(14, Math.max(4, (w[key] || []).length + 1)) +
        '" style="width:100%;padding:10px 12px;font:400 12.8px/1.7 var(--sans);' +
        'border:1.5px solid #d8dde4;border-radius:9px;resize:vertical">' + esc(lines) +
      '</textarea></div>';
  };

  const chips = (key, label, hint) => {
    const list = w[key] || [];
    return '<div class="p-card" style="margin-bottom:10px">' +
      '<label style="display:block;font:700 13.4px/1.4 var(--sans);color:var(--navy-900);' +
        'margin-bottom:3px">' + esc(label) +
        ' <span style="font-weight:600;color:var(--muted)">(' + list.length + ')</span></label>' +
      '<p style="margin:0 0 9px;font-size:12.2px;color:var(--muted);line-height:1.5">' +
        esc(hint) + '</p>' +
      '<div style="overflow-x:auto"><table class="tbl" style="margin:0">' +
      '<thead><tr><th style="width:34%">What the student sees</th>' +
      '<th>The words that go into the draft</th></tr></thead><tbody>' +
      list.map((c, i) =>
        '<tr><td><input id="ck_' + key + '_' + i + '" value="' + esc(c.label) + '"></td>' +
        '<td><input id="cp_' + key + '_' + i + '" value="' + esc(c.phrase) + '"></td></tr>').join('') +
      '</tbody></table></div></div>';
  };

  let html = '';
  if (aiKind === 'sop') {
    html += chips('signals', 'What should it draw on?',
      'The chips on the first row. The right-hand column is dropped into a sentence, so it '
      + 'has to read as part of one: "my final-year project", not "Final-year project".');
    html += chips('motives', 'Why this course?',
      'The second row of chips. These follow "I want to ...", so write them that way: '
      + '"go deeper into this specialisation".');
  } else {
    html += chips('signals', 'What did they actually see?',
      'These follow "What I saw was ...", so write them as things: "their analytical rigour".');
  }
  AI_LISTS[aiKind].forEach(([k, label, hint]) => { html += box(k, label, hint); });
  $('#aiPanes').innerHTML = html;

  const meta = C.updated && C.updated.writing;
  $('#aiWhen').textContent = meta
    ? 'Last changed by ' + meta.who + ' ' + timeAgo(meta.updated_at) : '';
}

/*
 * The band each row actually produces, written under it.
 *
 * The labels are written as floors — "₹20L+" — and the field is a ceiling, so
 * the first person to read this screen asked why the band called ₹20L+ had
 * 40,00,000 in it. It is the top of the band, and the band starts where the one
 * above it stopped. Rather than explain that in a paragraph nobody reads, the
 * screen now says the range back as you type it.
 */
function paintBandRanges() {
  const lakh = v => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n === 0) return '\u20b90';          /* "₹0L" is not a thing anybody writes */
    return '\u20b9' + (n / 100000).toFixed(n % 100000 ? 2 : 0) + 'L';
  };
  let floor = 0;
  $$('#bandRows .bandRange').forEach(el => {
    const n = el.dataset.n;
    const raw = $('#bc' + n) ? $('#bc' + n).value.trim() : '';
    const top = lakh(raw);
    const from = lakh(floor);
    /* Unreachable is checked FIRST. A second blank ceiling below a blank one
       fell through to the "everything above" line with nothing to put in it,
       and printed "Holds everything above null". */
    if (floor === null) {
      el.textContent = 'Never matches \u2014 a band above it has no ceiling, '
        + 'so everything is caught before it gets here.';
      return;
    }
    if (!top) {
      el.textContent = 'Holds everything above ' + from + '.';
      floor = null;
      return;
    }
    /* A ceiling at or below the band above it can never be reached: the row
       above takes everything first. Printing "holds ₹25L to ₹20L" would be the
       screen repeating a mistake back as though it were a fact. */
    el.textContent = Number(raw) <= floor
      ? 'Never matches \u2014 this ceiling is not above the band before it.'
      : 'Holds ' + from + ' to ' + top + '.';
    floor = Math.max(floor, Number(raw));
  });
}

document.addEventListener('input', e => {
  if (e.target && /^bc\d+$/.test(e.target.id)) paintBandRanges();
});

/* What is on the screen, as the block the server stores. Read out of the DOM
   rather than tracked in a variable, so what you see is what saves. */
function aiFromScreen() {
  const out = JSON.parse(JSON.stringify(C.writing));
  const w = out[aiKind];
  const lines = id => ($('#ai_' + id) ? $('#ai_' + id).value : '')
    .split('\n').map(x => x.trim()).filter(Boolean);
  AI_LISTS[aiKind].forEach(([k]) => { w[k] = lines(k); });
  const chipKeys = aiKind === 'sop' ? ['signals', 'motives'] : ['signals'];
  chipKeys.forEach(key => {
    w[key] = (w[key] || []).map((c, i) => ({
      key: c.key,
      label: $('#ck_' + key + '_' + i) ? $('#ck_' + key + '_' + i).value.trim() : c.label,
      phrase: $('#cp_' + key + '_' + i) ? $('#cp_' + key + '_' + i).value.trim() : c.phrase,
    })).filter(c => c.label);
  });
  return out;
}

/* ----------------------------------------------------------------- legal */

/* What each blank is called on the page that needs it, so the gap list can say
   "the Grievance page still has no named officer" rather than "officer.name is
   empty". A missing particular is a compliance gap, not a null. */
const LEGAL_FIELDS = [
  ['lgEntity',    'entity',             'Legal entity name',   'all four pages'],
  ['lgCin',       'cin',                'CIN',                 'all four pages'],
  ['lgGstin',     'gstin',              'GSTIN',               'all four pages'],
  ['lgAddress',   'address',            'Registered office',   'all four pages'],
  ['lgEffective', 'effective',          'Effective date',      'all four pages'],
  ['lgJuris',     'jurisdiction',       'Courts of',           'Terms of Use'],
  ['lgInvoice',   'invoiceSeries',      'Invoice series',      'your invoices'],
  ['lgOffName',   'officer.name',       'Officer name',        'Grievance'],
  ['lgOffRole',   'officer.designation', 'Officer designation', 'Grievance'],
  ['lgOffMail',   'officer.email',      'Officer email',       'Grievance'],
  ['lgOffPhone',  'officer.phone',      'Officer phone',       'Grievance'],
];

const dig = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

function paintLegal() {
  const L = C.legal || {};
  LEGAL_FIELDS.forEach(([id, path]) => {
    const el = $('#' + id);
    if (el) el.value = dig(L, path) == null ? '' : dig(L, path);
  });

  /* The count on the tab is the number of blanks, not the number of fields —
     a tab that reads "Legal 4" is asking to be opened. Zero is hidden the way
     an empty count is hidden everywhere else on this screen. */
  const missing = LEGAL_FIELDS.filter(([, path]) => !String(dig(L, path) || '').trim());
  const n = $('#nLegal');
  if (n) { n.textContent = missing.length; n.hidden = !missing.length; }

  $('#legalGaps').innerHTML = missing.length
    ? '<ul class="doclist">' + missing.map(([, , label, where]) =>
        '<li><div><b>' + esc(label) + '</b>' +
        '<span style="display:block;font-size:11.8px;color:var(--muted)">Needed by ' +
        esc(where) + '</span></div><span class="st wait">blank</span></li>').join('') +
      '</ul>' +
      '<p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">' +
      'Nothing here is guessed and nothing is filled in for you. Until a line is typed, ' +
      'the pages leave it out rather than printing a placeholder.</p>'
    : '<div class="sl-empty" style="margin:0"><b>Every particular is filled in</b>' +
      '<p>The four pages are quoting these. Check them once on the live site.</p></div>';

  /* One box per package that is actually sold. A package with no pledge can
     still carry terms — what is refundable is a term whether or not anything
     is promised on the card. */
  const items = ((C.packages || {}).items || []).filter(p => p.active !== false);
  $('#legalTerms').innerHTML = items.map(p =>
    '<div class="field" style="margin-bottom:14px">' +
    '<label for="lgT-' + esc(p.id) + '">' + esc(p.title || p.id) +
      (p.pledge && p.pledge.title
        ? '<span style="font-weight:400;color:var(--muted)"> &mdash; ' +
          esc(p.pledge.title) + '</span>'
        : '') + '</label>' +
    '<textarea id="lgT-' + esc(p.id) + '" data-terms="' + esc(p.id) + '" rows="' +
      (p.terms ? 10 : 3) + '" placeholder="No terms published for this package yet.">' +
      esc(p.terms || '') + '</textarea></div>').join('') ||
    '<p style="color:var(--muted);font-size:13px">No packages are on the site yet.</p>';
}

async function saveLegal() {
  const btn = $('#lgSave');
  btn.disabled = true;
  try {
    /* EVERYTHING is read off the screen first, before a single save.
       saveList repaints this tab from the reloaded block, so saving the
       particulars and then reading the package boxes reads them AFTER the
       repaint has already put the old text back — and the terms somebody just
       typed are silently thrown away. It is not a race; it happens every
       time. */
    const value = { officer: {} };
    LEGAL_FIELDS.forEach(([id, path]) => {
      const v = ($('#' + id) || {}).value || '';
      if (path.indexOf('officer.') === 0) value.officer[path.slice(8)] = v;
      else value[path] = v;
    });

    /* The per-package terms ride on the packages block, not on this one. Saving
       them here rather than making somebody find the package editor is the
       point of putting them on this screen. */
    const items = ((C.packages || {}).items || []).map(p => {
      const box = $('[data-terms="' + p.id + '"]');
      return box ? Object.assign({}, p, { terms: box.value }) : p;
    });
    const pkgs = Object.assign({}, C.packages, { items });

    await saveList('legal', value);
    await saveList('packages', pkgs);

    const ok = $('#lgSaved');
    ok.hidden = false;
    setTimeout(() => { ok.hidden = true; }, 2500);
  } catch (e) {
    alert(e.message || 'That did not save.');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', e => {
  if (e.target.closest('#lgSave')) saveLegal();
});

function paintAll() {
  paintPackages(); paintServices(); paintStats(); paintFaq(); paintStories();
  paintText(); paintSheet(); paintAi(); paintFinder(); paintLegal();
}

async function reload() {
  C = await api('GET', '/api/staff/content');
  TEXT = C.text;
  paintAll();
}

/* ------------------------------------------------------------ the packages */

function openEditor(p) {
  editing = p || null;
  const v = p || {tab: 'study', sell: true, active: true, features: [], priceFrom: 'From',
    quote: 'Priced after we assess your case', quoteSmall: 'Free first call · no obligation'};
  $('#pmTitle').textContent = p ? 'Edit package' : 'Add a package';
  $('#pmLead').textContent = p
    ? 'Changes are on the home page, and in the checkout, as soon as you save.'
    : 'It is on the home page as soon as you save.';
  $('#pmDelete').style.display = p ? '' : 'none';
  $('#pmErr').style.display = 'none';

  const sel = (label, id, value, opts, help) =>
    '<div class="field" style="margin-bottom:10px"><label for="' + id + '">' + esc(label) +
    '</label><select id="' + id + '">' + opts.map(([o, t]) =>
      '<option value="' + esc(o) + '"' + (String(o) === String(value) ? ' selected' : '') +
      '>' + esc(t) + '</option>').join('') + '</select>' +
    (help ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted);line-height:1.5">' +
      help + '</p>' : '') + '</div>';

  const pl = v.pledge || {};
  $('#pmBody').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      tf('Name', 'fTitle', v.title, 'Boarding Pass') +
      sel('Which tab', 'fTab', v.tab, C.packages.tabs.map(t => [t.key, t.label])) +
    '</div>' +
    ta('The line under the name', 'fDesc', v.desc, true) +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      sel('How it is sold', 'fSell', v.sell ? '1' : '0',
        [['1', 'A price and a Buy button'], ['0', 'Priced after we speak to them']],
        'The second kind sends them to the enquiry form instead of checkout.') +
      /* type="number", with a floor. It was type="text", so -9999 and
         "abc-sudhin" were both typed in, both stored as 0, and the package
         stayed on sale at nothing. The server refuses either now; this is so
         nobody gets that far. */
      tf('Price, \u20b9', 'fPrice', v.priceInr || 0, '74999', 0, 1) +
      tf('Word before the price', 'fFrom', v.priceFrom, 'From') +
      tf('Note under the price', 'fNote', v.priceNote, 'including taxes') +
      tf('Universities revealed', 'fUnlocks', v.unlocks || 0, '15') +
      tf('Matched automatically', 'fMatches', v.matches || 0, '3') +
      tf('Ribbon', 'fRibbon', v.ribbon, 'Most popular') +
      tf('Instead of a price', 'fQuote', v.quote, 'Priced after we assess your case') +
      tf('Small print under that', 'fQuoteSmall', v.quoteSmall, 'Free first call · no obligation') +
      tf('Button label', 'fCta', v.cta, 'Choose Boarding Pass') +
      tf('Button link', 'fHref', v.ctaHref, '#counsel') +
    '</div>' +
    /* The field that makes the cheap tiers possible, and the one whose meaning
       is not obvious from its name. */
    '<p style="margin:-2px 0 12px;font-size:11.8px;color:var(--muted);line-height:1.55">' +
      '<b>Matched automatically</b> is how many universities the system picks for ' +
      'the student the moment they pay, with nobody doing it by hand. Leave it at 0 ' +
      'for packages where a counsellor agrees the shortlist on a call. If ' +
      '<b>Universities revealed</b> is above zero the matches are public ' +
      'universities, named; if it is zero they are private ones.</p>' +
    ta("What's included — one per line", 'fFeatures', (v.features || []).join('\n'), true) +
    '<h3 style="font-size:14px;margin:8px 0 10px">Guarantee panel</h3>' +
    '<p style="margin:-4px 0 10px;font-size:11.8px;color:var(--muted);line-height:1.5">' +
      'Leave the heading empty for no panel. This is a promise the business has to keep — ' +
      'write it the way you would defend it.</p>' +
    tf('Heading', 'fPlT', pl.title, 'An admission offer, guaranteed — or your money back.') +
    ta('The promise', 'fPlB', pl.body, true) +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px">' +
      sel('Colour', 'fPlTone', pl.tone || 'green',
        [['green', 'Green'], ['gold', 'Gold'], ['blue', 'Blue']]) +
      tf('Terms link', 'fPlHref', pl.href, 'refunds.html#guarantee-terms') +
      tf('Link text', 'fPlLink', pl.linkText || 'Full terms', 'Full terms') +
    '</div>' +
    ta('Tick box at checkout — leave empty for none', 'fConsent', v.consent, true) +
    tick('Show this package on the website', 'fActive', v.active !== false) +
    tick('Highlight it (raised card and a coloured button)', 'fFeatured', v.featured);

  /* Half these fields belong to one kind of package and half to the other.
     Showing all of them at once is how somebody fills in a price on a card
     that says "priced after we assess your case". */
  const showRelevant = () => {
    const selling = $('#fSell').value === '1';
    [['fPrice', selling], ['fFrom', selling], ['fNote', selling],
     ['fQuote', !selling], ['fQuoteSmall', !selling], ['fHref', !selling]]
      .forEach(([id, on]) => {
        const box = $('#' + id).closest('.field');
        if (box) box.style.display = on ? '' : 'none';
      });
  };
  $('#fSell').addEventListener('change', showRelevant);
  showRelevant();

  $('#pkgModal').classList.add('on');
  setTimeout(() => $('#fTitle').focus(), 50);
}

function readEditor() {
  const sell = $('#fSell').value === '1';
  return {
    id: editing ? editing.id : '',
    tab: $('#fTab').value,
    title: $('#fTitle').value,
    desc: $('#fDesc').value,
    sell,
    priceInr: sell ? Number($('#fPrice').value || 0) : 0,
    priceFrom: $('#fFrom').value,
    priceNote: $('#fNote').value,
    unlocks: Number($('#fUnlocks').value || 0),
    matches: Number($('#fMatches').value || 0),
    ribbon: $('#fRibbon').value,
    quote: $('#fQuote').value,
    quoteSmall: $('#fQuoteSmall').value,
    cta: $('#fCta').value,
    ctaHref: $('#fHref').value,
    consent: $('#fConsent').value,
    features: $('#fFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
    active: $('#fActive').checked,
    featured: $('#fFeatured').checked,
    primary: $('#fFeatured').checked,
    sort: editing ? editing.sort : 999,
    pledge: $('#fPlT').value.trim() || $('#fPlB').value.trim() ? {
      tone: $('#fPlTone').value, title: $('#fPlT').value, body: $('#fPlB').value,
      href: $('#fPlHref').value, linkText: $('#fPlLink').value,
    } : null,
  };
}

const savePackages = items =>
  api('PUT', '/api/staff/content/packages',
    {value: Object.assign({}, C.packages, {items})});

/* ------------------------------------------------------ the simple lists */

const READ = {
  stats: () => C.stats.map((s, n) => ({
    num: $('#num' + n).value, label: $('#lbl' + n).value, dummy: $('#sd' + n).checked})),
  faq: () => C.faq.map((f, n) => ({
    q: $('#q' + n).value, a: $('#a' + n).value, dummy: $('#fd' + n).checked})),
  testimonials: () => C.testimonials.map((t, n) => ({
    name: $('#tn' + n).value, route: $('#tr' + n).value, where: $('#tw' + n).value,
    intake: $('#ti' + n).value,
    quote: $('#tq' + n).value, verified: $('#tv' + n).checked, dummy: $('#td' + n).checked})),
};
const BLANK = {
  stats: {num: '', label: '', dummy: true},
  faq: {q: '', a: '', dummy: true},
  testimonials: {name: '', route: '', where: '', intake: '', quote: '', verified: false, dummy: true},
};
/* Which pane a list is in, so a save can repaint the right one without a
   reload — a reload would throw away whatever else is half-typed on screen. */
const PANE = {stats: 'num', faq: 'faq', testimonials: 'sto'};

async function saveList(key, value) {
  const r = await api('PUT', '/api/staff/content/' + key, {value});
  C[key] = r.saved;
  paintAll();
  return r;
}

/* --------------------------------------------------------------- behaviour */

document.addEventListener('click', async e => {
  const t = e.target.closest('.tab[data-t]');
  if (t) {
    $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
    return;
  }
  if (e.target.closest('[data-close]') || e.target === $('#pkgModal')) {
    $('#pkgModal').classList.remove('on');
    return;
  }

  /* ---- services ---- */
  if (e.target.closest('#addSvc')) return openService(null);
  const se = e.target.closest('[data-sedit]');
  if (se) return openService((C.services.items || []).find(x => x.id === se.dataset.sedit));
  if (e.target.closest('[data-sclose]') || e.target === $('#svcModal')) {
    $('#svcModal').classList.remove('on');
    return;
  }
  if (e.target.closest('#smSave')) {
    const btn = e.target.closest('#smSave');
    const body = readService();
    $('#smErr').style.display = 'none';
    if (!body.name.trim()) {
      $('#smErr').textContent = 'A service needs a name.';
      $('#smErr').style.display = 'block';
      return;
    }
    const items = (C.services.items || []).slice();
    if (editingSvc) {
      items[items.findIndex(x => x.id === editingSvc.id)] = body;
    } else {
      body.id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        || ('svc-' + (items.length + 1));
      items.push(body);
    }
    btn.disabled = true;
    try {
      const r = await saveServices(items);
      C.services = r.saved;
      $('#svcModal').classList.remove('on');
      paintServices();
      toast(editingSvc ? 'Saved — it is live on the home page.'
                       : 'Added — it is live on the home page.');
    } catch (err) {
      $('#smErr').textContent = err.message;
      $('#smErr').style.display = 'block';
    } finally { btn.disabled = false; }
    return;
  }
  if (e.target.closest('#smDelete') && editingSvc) {
    const items = (C.services.items || []).filter(x => x.id !== editingSvc.id);
    if (!items.length) return toast('That is the last service. Hide it instead of removing it.');
    try {
      const r = await saveServices(items);
      C.services = r.saved;
      $('#svcModal').classList.remove('on');
      paintServices();
      toast('Removed from the home page.');
    } catch (err) { toast(err.message); }
    return;
  }

  /* ---- packages ---- */
  const ed = e.target.closest('[data-edit]');
  if (ed) return openEditor(C.packages.items.find(p => p.id === ed.dataset.edit));
  if (e.target.closest('#addPkg')) return openEditor(null);

  const mv = e.target.closest('[data-move]');
  if (mv) {
    const items = C.packages.items.slice();
    const i = items.findIndex(p => p.id === mv.dataset.move);
    const dir = Number(mv.dataset.dir);
    /* Within its own tab. Moving a package past the end of its tab and into
       the next one is never what the arrow meant. */
    const sameTab = items.filter(p => p.tab === items[i].tab);
    const at = sameTab.indexOf(items[i]);
    if (at + dir < 0 || at + dir >= sameTab.length) return;
    const j = items.indexOf(sameTab[at + dir]);
    items[i].sort = j + 1; items[j].sort = i + 1;
    const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    items.forEach((p, n) => { p.sort = n + 1; });
    try { const r = await savePackages(items); C.packages = r.saved; paintPackages(); }
    catch (err) { toast(err.message); }
    return;
  }

  if (e.target.closest('#pmSave')) {
    const body = readEditor();
    $('#pmErr').style.display = 'none';
    if (!body.title.trim()) {
      $('#pmErr').textContent = 'A package needs a name.';
      $('#pmErr').style.display = 'block';
      return;
    }
    const items = C.packages.items.slice();
    if (editing) {
      const i = items.findIndex(p => p.id === editing.id);
      items[i] = Object.assign({}, items[i], body);
    } else {
      body.id = body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        || ('pkg-' + (items.length + 1));
      items.push(body);
    }
    try {
      const r = await savePackages(items);
      C.packages = r.saved;
      $('#pkgModal').classList.remove('on');
      paintPackages();
      toast(editing ? 'Saved — it is live on the home page.' : 'Added — it is live on the home page.');
    } catch (err) {
      $('#pmErr').textContent = err.message;
      $('#pmErr').style.display = 'block';
    }
    return;
  }

  if (e.target.closest('#pmDelete') && editing) {
    const items = C.packages.items.filter(p => p.id !== editing.id);
    if (!items.length) return toast('That is the last package. Hide it instead of removing it.');
    try {
      const r = await savePackages(items);
      C.packages = r.saved;
      $('#pkgModal').classList.remove('on');
      paintPackages();
      toast('Removed from the home page.');
    } catch (err) { toast(err.message); }
    return;
  }

  /* ---- the three simple lists ---- */
  const add = e.target.closest('[data-add]');
  if (add) {
    const key = add.dataset.add;
    C[key] = READ[key]().concat([BLANK[key]]);
    paintAll();
    return;
  }
  const rd = e.target.closest('[data-rdel]');
  const rm = e.target.closest('[data-rmove]');
  if (rd || rm) {
    const pane = (rd || rm).closest('.pane').id.slice(2);
    const key = Object.keys(PANE).find(k => PANE[k] === pane);
    const rows = READ[key]();
    if (rd) {
      rows.splice(Number(rd.dataset.rdel), 1);
      if (!rows.length) return toast('Leave at least one — an empty section is refused.');
    } else {
      const i = Number(rm.dataset.rmove), j = i + Number(rm.dataset.dir);
      if (j < 0 || j >= rows.length) return;
      const tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
    }
    try { await saveList(key, rows); toast('Saved.'); }
    catch (err) { toast(err.message); }
    return;
  }
  const sv = e.target.closest('[data-save]');
  if (sv) {
    try { await saveList(sv.dataset.save, READ[sv.dataset.save]()); toast('Saved — it is live.'); }
    catch (err) { toast(err.message); }
    return;
  }

  /* ---- page text ---- */
  const ts = e.target.closest('[data-tsave]');
  if (ts) {
    const box = $('[data-tkey="' + ts.dataset.tsave.replace(/"/g, '\\"') + '"]');
    try {
      await api('PUT', '/api/staff/content/text', {key: ts.dataset.tsave, value: box.value});
      await reloadText();
      toast('Saved — it is live on the home page.');
    } catch (err) { toast(err.message); }
    return;
  }
  const tr = e.target.closest('[data-treset]');
  if (tr) {
    try {
      await api('PUT', '/api/staff/content/text', {key: tr.dataset.treset, value: ''});
      await reloadText();
      toast('Back to what the page said before.');
    } catch (err) { toast(err.message); }
    return;
  }

  /* ---- the spreadsheet ---- */
  if (e.target.closest('#sCheck')) {
    $('#sOut').innerHTML = '';
    $('#sBusy').style.display = '';
    try { paintPlan(await sheetPost({})); }
    catch (err) {
      $('#sOut').innerHTML = '<p role="alert" style="margin:0;padding:11px 13px;border-radius:10px;' +
        'font:600 12.8px/1.5 var(--sans);background:#fdf3f2;border:1px solid #f0c8c4;color:#7a2118">' +
        esc(err.message) + '</p>';
    } finally { $('#sBusy').style.display = 'none'; }
    return;
  }
  if (e.target.closest('#sCancel')) { $('#sOut').innerHTML = ''; return; }
  if (e.target.closest('#sApply')) {
    const btn = e.target.closest('#sApply');
    btn.disabled = true; btn.textContent = 'Applying…';
    try {
      const r = await sheetPost({confirm: 'yes'});
      await reload();
      $('#sOut').innerHTML = '<p style="margin:0;padding:12px 14px;border-radius:10px;' +
        'font:600 13px/1.55 var(--sans);background:#f1f8f3;border:1px solid #c8e3d0;color:#1d5c33">' +
        (r.applied ? 'Done — it is live on the home page now.' : 'Done.') + '</p>';
      $('#sFile').value = '';
      toast('Home page updated from the sheet.');
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Try again';
      toast(err.message);
    }
    return;
  }
});

async function reloadText() {
  const r = await api('GET', '/api/staff/content');
  C = r; TEXT = r.text;
  paintAll();
}

/* ---------------------------------------------------------- the spreadsheet */

async function sheetPost(fields) {
  const f = $('#sFile').files[0];
  if (!f) throw new Error('Choose a file first.');
  const fd = new FormData();
  fd.append('file', f, f.name);
  Object.keys(fields || {}).forEach(k => fd.append(k, fields[k]));
  const what = $('#sWhat').value;
  const url = what === 'text'
    ? '/api/staff/content/text/import'
    : '/api/staff/content/' + what + '/import';
  const r = await fetch(url, {method: 'POST', credentials: 'same-origin', body: fd});
  if (r.status === 401) { location.href = 'login.html'; throw new Error('signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.data = data; throw e; }
  return data;
}

const list = (title, items, render, tone) => items && items.length
  ? '<h3 style="font-size:13.6px;margin:20px 0 0' + (tone ? ';color:' + tone : '') + '">' +
    esc(title) + '</h3><ul class="doclist" style="margin:10px 0 0">' +
    items.slice(0, 12).map(render).join('') +
    (items.length > 12 ? '<li style="color:var(--muted)"><span>… and ' +
      (items.length - 12) + ' more</span></li>' : '') + '</ul>'
  : '';

function paintPlan(d) {
  const c = d.counts || {}, p = d.plan || {};
  const box = (n, label, tone) => '<div><b style="color:' + tone + '">' + n +
    '</b><span>' + label + '</span></div>';
  const isText = $('#sWhat').value === 'text';

  let html = '<div class="out tiles" style="--tiles:' +
    (isText ? 3 : 4) + ';margin:0">' +
    (isText
      ? box(c.change || 0, 'to reword', 'var(--navy-900)') +
        box(c.revert || 0, 'back to original', 'var(--muted)') +
        box(c.rejected || 0, 'cannot use', (c.rejected ? '#a5311f' : 'var(--muted)'))
      : box(c.total || 0, 'will be on the page', 'var(--navy-900)') +
        box(c.create || 0, 'new', 'var(--navy-900)') +
        box(c.removed || 0, 'come off the page', (c.removed ? '#a5311f' : 'var(--muted)')) +
        box(c.rejected || 0, 'cannot use', (c.rejected ? '#a5311f' : 'var(--muted)'))) +
    '</div>';

  if (d.note) {
    html += '<p style="margin:14px 0 0;padding:11px 13px;border-radius:10px;background:#fffaf0;' +
      'border:1px solid #f0dcb4;font:600 12.6px/1.55 var(--sans);color:#7a5510">' +
      esc(d.note) + '</p>';
  }
  if ((p.unknownColumns || []).length) {
    html += '<p style="margin:10px 0 0;font:600 12.4px/1.5 var(--sans);color:var(--muted)">' +
      'Columns that were not recognised and were left alone: ' +
      p.unknownColumns.map(esc).join(', ') + '</p>';
  }

  html += list('Rows that cannot be used', p.rejected, r =>
    '<li><span style="flex:1"><b>Row ' + r.line + '</b> — ' + esc(r.what || '(blank)') +
    '<br><span style="font-size:11.8px;color:#a5311f">' + r.why.map(esc).join('; ') +
    '</span></span></li>');
  html += list('Coming off the page', p.removed, r =>
    '<li><span style="flex:1">' + esc(r.what) + '</span></li>', '#a5311f');
  html += list('New', p.create, r => '<li><span style="flex:1">' + esc(r.what) + '</span></li>');
  html += list('Reworded', p.change, r =>
    '<li><span style="flex:1"><b>' + esc(r.section) + '</b><br>' +
    '<span style="font-size:11.8px;color:var(--muted)">' + esc(r.was) + '</span><br>' +
    esc(r.now) + '</span></li>');
  html += list('Back to original', p.revert, r =>
    '<li><span style="flex:1">' + esc(r.now) + '</span></li>');

  const n = isText ? (c.change || 0) + (c.revert || 0) : (c.total || 0);
  if (!n) {
    html += '<p style="margin:18px 0 0;font:600 13px/1.5 var(--sans)">' +
      'Nothing in that sheet changes anything.</p>';
  } else {
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px;' +
      'padding-top:18px;border-top:1px solid var(--line,#e6e9ee)">' +
      '<button type="button" class="btn btn-primary" id="sApply">Apply this</button>' +
      '<button type="button" class="btn btn-ghost" id="sCancel">Cancel</button></div>';
  }
  $('#sOut').innerHTML = html;
}

/* ------------------------------------------------------------------- boot */

['tq', 'tsec', 'tonly'].forEach(id => {
  $('#' + id).addEventListener('input', paintText);
  $('#' + id).addEventListener('change', paintText);
});
$('#sFile').addEventListener('change', () => { $('#sOut').innerHTML = ''; });
$('#sWhat').addEventListener('change', () => { $('#sOut').innerHTML = ''; });
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('#pkgModal').classList.remove('on');
    $('#svcModal').classList.remove('on');
  }
});

/* ------------------------------------------------------- studio behaviour */

document.addEventListener('click', async e => {
  const t = e.target.closest('.tab-ai');
  if (t) {
    /* Keep what is on the screen before switching, or a counsellor who edits
       the SOP, looks at the LOR and comes back finds their work gone. */
    C.writing = aiFromScreen();
    aiKind = t.dataset.a;
    $$('.tab-ai').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    paintAi();
    return;
  }

  if (e.target.closest('#aiSave')) {
    const btn = e.target.closest('#aiSave');
    btn.disabled = true;
    try {
      const r = await api('PUT', '/api/staff/content/writing', {value: aiFromScreen()});
      C.writing = r.saved;
      await reload();
      toast('Saved — the studio writes with this from now on.');
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
    return;
  }

  if (e.target.closest('#aiPreview')) {
    /* Written against what is on the screen, saved or not, so the person
       rewriting a sentence can see it land before committing to it. */
    const out = $('#aiPrev');
    out.innerHTML = '<p style="font-size:12.8px;color:var(--muted)">Writing…</p>';
    try {
      const draft = await api('POST', '/api/staff/content/writing/preview', {
        value: aiFromScreen(),
        kind: aiKind,
      });
      const d = draft.draft;
      out.innerHTML = '<div class="p-card">' +
        '<b style="font:700 12.4px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;' +
          'color:var(--muted)">A draft for a made-up student · ' + d.words + ' words</b>' +
        d.paragraphs.map(x => '<p style="margin:12px 0 0;font-size:13.4px;line-height:1.75">' +
          esc(x) + '</p>').join('') +
        '<p style="margin:14px 0 0;font-size:12px;color:var(--muted)">' + esc(d.caveat) + '</p>' +
        '</div>';
    } catch (err) {
      out.innerHTML = '<p role="alert" style="margin:0;padding:11px 13px;border-radius:10px;' +
        'font:600 12.8px/1.5 var(--sans);background:#fdf3f2;border:1px solid #f0c8c4;' +
        'color:#7a2118">' + esc(err.message) + '</p>';
    }
    return;
  }
});

/* The three simple lists save as a block, so each pane gets one Save button
   rather than one per row — a row-level save on a block API would write the
   other rows' half-typed state along with it. */
['num', 'faq', 'sto'].forEach(pane => {
  const key = Object.keys(PANE).find(k => PANE[k] === pane);
  const host = document.getElementById('t-' + pane).querySelector('.p-card');
  host.insertAdjacentHTML('beforeend',
    '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#e6e9ee)">' +
    '<button type="button" class="btn btn-primary" data-save="' + key + '">Save this section</button>' +
    '</div>');
});

staffBoot(async me => {
  /* The API refuses the change anyway. This is so the refusal is not the first
     thing they learn about it, after typing a page of copy. */
  if ((me.user.perms || []).indexOf('content') < 0) {
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>You do not have access to the home page</b>' +
      '<p>An administrator can give it to you on the Organisation screen &mdash; it is a tick box beside your name.</p>' +
      '<a class="btn btn-primary" href="counsellor.html">Go to Conversations</a></div>';
    return;
  }

  await reload();
  connectLive({});
});
"""
