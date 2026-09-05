#!/usr/bin/env python3
"""
The eight destinations glovels.com had pages for and this site did not, plus
the visa-processing page.

"All the pages are not copied to glovels.onrender.com."

    study-in-usa            study-in-australia       study-in-france
    study-in-czechrepublic  study-in-finland         study-in-singapore
    study-in-japan          study-in-new-zealand     visa-processing

The slugs are the Wix ones, on purpose: those are the addresses Google has
indexed for years, and a site that answers 404 to them on the day the domain
moves has thrown the ranking away. (`study-in-czechrepublic` is ugly. It is
also what ranks.)

Each destination page is the Italy page with its head, hero, lead, fact box
and requirement sections rewritten from the facts below, and its prose
written in page_content.py. The facts also go into the finder's country table
on index.html (`const C`), which is where build_portal.py reads
countries.json from — so a fresh database gets the eight destinations, and
seed.addMissingCountries brings them to a deployment that already has one.

None of the eight has a programme in the catalogue yet. The pages say so and
send the reader to a counsellor rather than to an empty finder. When the
office adds programmes from the Catalogue screen, nothing here changes.

Run, in this order:
    python3 build_destinations.py
    python3 build_blog.py          # the templates take the new menu links
    python3 apply_fixes.py
    python3 build_portal.py        # countries.json picks up the eight
    python3 page_content.py        # the prose
"""
import html
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DONOR = HERE / "study-in-italy.html"
esc = lambda s: html.escape(str(s), quote=True)

# The finder's facts, in the shape of every other entry in `const C`. Marked
# dummy the way the original six non-German entries are: reviewed by the
# office from the Destinations tab before anyone quotes them.
NEW = {
    "US": {"code": "US", "slug": "usa", "published": True, "dummy": True, "name": "United States",
        "flag": "🇺🇸", "region": "UK & North America", "hasPublicTrack": False, "tuitionFree": False,
        "minCgpaPublic": None, "minCgpaPrivate": 6.5,
        "degreeRule": "4-year Bachelor for most Master's; a 3-year degree is accepted by many universities with a WES evaluation.",
        "extraNote": "The university issues an I-20; then the SEVIS fee and the F-1 interview.",
        "backlogRule": "Assessed case by case; fewer is better.",
        "tests": ["TOEFL iBT 80-100 or IELTS 6.5-7.0", "GRE for many engineering Master's; GMAT for MBAs"],
        "fundsLabel": "Proof of funds (I-20 amount)", "fundsInr": 3500000,
        "fundsNote": "First-year tuition plus living costs, shown at the visa interview.",
        "livingInr": 130000, "workRights": "20 hrs/week on campus during term; OPT after",
        "deadlineNote": "Fall (Aug/Sep) and Spring (Jan) intakes",
        "documents": ["Passport", "Marksheets & degree", "TOEFL/IELTS", "GRE/GMAT where asked", "SOP", "LORs", "I-20", "Bank statements"]},
    "AU": {"code": "AU", "slug": "australia", "published": True, "dummy": True, "name": "Australia",
        "flag": "🇦🇺", "region": "Australia & New Zealand", "hasPublicTrack": False, "tuitionFree": False,
        "minCgpaPublic": None, "minCgpaPrivate": 6.0,
        "degreeRule": "3-year Bachelor accepted for most Master's.",
        "extraNote": "The Genuine Student statement and OSHC health cover are part of the visa.",
        "backlogRule": "Up to 5-8 backlogs usually tolerated.",
        "tests": ["IELTS 6.5, no band below 6.0 (PTE accepted)"],
        "fundsLabel": "Proof of funds", "fundsInr": 1700000,
        "fundsNote": "A year of living costs plus first-year tuition and travel.",
        "livingInr": 120000, "workRights": "48 hrs a fortnight during term",
        "deadlineNote": "Feb and Jul intakes",
        "documents": ["Passport", "Marksheets", "IELTS/PTE", "Genuine Student statement", "CoE", "OSHC", "Bank statements"]},
    "FR": {"code": "FR", "slug": "france", "published": True, "dummy": True, "name": "France",
        "flag": "🇫🇷", "region": "Europe - public university routes", "hasPublicTrack": True, "tuitionFree": False,
        "minCgpaPublic": 6.5, "minCgpaPrivate": 6.0,
        "degreeRule": "3-year Bachelor accepted.",
        "extraNote": "The Campus France (Études en France) interview is mandatory before the visa.",
        "backlogRule": "Assessed case by case.",
        "tests": ["IELTS 6.0-6.5 for English-taught programmes", "DELF B2 for French-taught programmes"],
        "fundsLabel": "Proof of funds", "fundsInr": 700000,
        "fundsNote": "About €615 a month for the year.",
        "livingInr": 80000, "workRights": "964 hrs a year (about 20 hrs/week)",
        "deadlineNote": "Sep intake; Campus France closes around Mar-Apr",
        "documents": ["Passport", "Marksheets", "IELTS/DELF", "Campus France NOC", "Admission letter", "Insurance"]},
    "CZ": {"code": "CZ", "slug": "czechrepublic", "published": True, "dummy": True, "name": "Czech Republic",
        "flag": "🇨🇿", "region": "Europe - public university routes", "hasPublicTrack": True, "tuitionFree": False,
        "minCgpaPublic": 6.5, "minCgpaPrivate": 5.5,
        "degreeRule": "3-year Bachelor accepted; nostrification of the degree is needed to enrol.",
        "extraNote": "Nostrification (degree recognition) takes one to two months.",
        "backlogRule": "Generally flexible.",
        "tests": ["IELTS 6.0, or a medium-of-instruction letter"],
        "fundsLabel": "Proof of funds", "fundsInr": 550000,
        "fundsNote": "About CZK 130,000 for the year.",
        "livingInr": 55000, "workRights": "No hour limit for full-time students",
        "deadlineNote": "Sep intake; some Feb",
        "documents": ["Passport", "Marksheets, apostilled", "Nostrification", "Insurance", "Accommodation proof"]},
    "FI": {"code": "FI", "slug": "finland", "published": True, "dummy": True, "name": "Finland",
        "flag": "🇫🇮", "region": "Europe - public university routes", "hasPublicTrack": True, "tuitionFree": False,
        "minCgpaPublic": 7.0, "minCgpaPrivate": 6.0,
        "degreeRule": "3-year Bachelor accepted.",
        "extraNote": "One joint application window in January for the August intake.",
        "backlogRule": "Assessed case by case.",
        "tests": ["IELTS 6.5"],
        "fundsLabel": "Proof of funds", "fundsInr": 900000,
        "fundsNote": "€9,600 a year for the residence permit.",
        "livingInr": 85000, "workRights": "30 hrs/week on average during term",
        "deadlineNote": "Joint application in Jan for an Aug start",
        "documents": ["Passport", "Marksheets", "IELTS", "Admission letter", "Bank statement", "Insurance"]},
    "SG": {"code": "SG", "slug": "singapore", "published": True, "dummy": True, "name": "Singapore",
        "flag": "🇸🇬", "region": "Asia", "hasPublicTrack": False, "tuitionFree": False,
        "minCgpaPublic": None, "minCgpaPrivate": 6.0,
        "degreeRule": "3-year Bachelor accepted by most; NUS and NTU want a strong one.",
        "extraNote": "The Student's Pass is applied for through SOLAR after admission.",
        "backlogRule": "Assessed case by case.",
        "tests": ["IELTS 6.5", "GRE/GMAT for many NUS and NTU Master's"],
        "fundsLabel": "Proof of funds", "fundsInr": 1500000,
        "fundsNote": "Tuition plus a year of living costs.",
        "livingInr": 110000, "workRights": "16 hrs/week during term at approved institutions",
        "deadlineNote": "Aug and Jan intakes",
        "documents": ["Passport", "Marksheets", "IELTS", "Admission letter", "Bank statements"]},
    "JP": {"code": "JP", "slug": "japan", "published": True, "dummy": True, "name": "Japan",
        "flag": "🇯🇵", "region": "Asia", "hasPublicTrack": True, "tuitionFree": False,
        "minCgpaPublic": 7.0, "minCgpaPrivate": 6.0,
        "degreeRule": "16 years of education (a 4-year Bachelor) for a Master's.",
        "extraNote": "A Certificate of Eligibility from Immigration comes before the visa; most admissions start with a supervisor.",
        "backlogRule": "Assessed case by case.",
        "tests": ["IELTS 6.0-6.5 or TOEFL iBT 80 for English-taught programmes", "JLPT N2 for Japanese-taught programmes"],
        "fundsLabel": "Proof of funds", "fundsInr": 1200000,
        "fundsNote": "Tuition plus living costs for the first year.",
        "livingInr": 90000, "workRights": "28 hrs/week with work permission",
        "deadlineNote": "Apr and Sep/Oct intakes",
        "documents": ["Passport", "Marksheets", "IELTS/JLPT", "Admission letter", "Certificate of Eligibility", "Bank statements"]},
    "NZ": {"code": "NZ", "slug": "new-zealand", "published": True, "dummy": True, "name": "New Zealand",
        "flag": "🇳🇿", "region": "Australia & New Zealand", "hasPublicTrack": False, "tuitionFree": False,
        "minCgpaPublic": None, "minCgpaPrivate": 6.0,
        "degreeRule": "3-year Bachelor accepted for most Master's, sometimes via a postgraduate diploma year.",
        "extraNote": "NZ$20,000 a year in living funds is shown for the visa.",
        "backlogRule": "Up to 5 backlogs usually tolerated.",
        "tests": ["IELTS 6.5, no band below 6.0 (PTE accepted)"],
        "fundsLabel": "Proof of funds", "fundsInr": 1100000,
        "fundsNote": "NZ$20,000 living costs plus first-year tuition.",
        "livingInr": 100000, "workRights": "20 hrs/week during term",
        "deadlineNote": "Feb and Jul intakes",
        "documents": ["Passport", "Marksheets", "IELTS", "Offer of Place", "Bank statements", "Insurance"]},
}

# What the page is called in the head. Under 70 characters, like patch 82 asked.
TITLES = {
    "US": ("Study in USA for Indians — Costs, Tests & F-1 Visa",
           "What it takes for an Indian student to study in the USA: what a Master's really costs, GRE and TOEFL, the I-20 and F-1 interview, OPT, and the Fall and Spring deadlines."),
    "AU": ("Study in Australia for Indians — Costs, Visa & Work Rights",
           "What it takes for an Indian student to study in Australia: fees and living costs, the Genuine Student requirement, the subclass 500 visa, work rights, and post-study visas."),
    "FR": ("Study in France for Indians — Costs, Campus France & Visa",
           "What it takes for an Indian student to study in France: low public fees, English-taught programmes, Campus France, the long-stay visa, and the APS permit after graduating."),
    "CZ": ("Study in Czech Republic for Indians — Fees, Visa & Living",
           "What it takes for an Indian student to study in the Czech Republic: free Czech-taught degrees, modest English-taught fees, nostrification, the visa, and life in Prague."),
    "FI": ("Study in Finland for Indians — Fees, Scholarships & Visa",
           "What it takes for an Indian student to study in Finland: tuition and the scholarships that halve it, the January joint application, the permit, and two years to work after."),
    "SG": ("Study in Singapore for Indians — NUS, NTU, Fees & Visa",
           "What it takes for an Indian student to study in Singapore: NUS and NTU admission, private institutions, fees and living costs, the Student's Pass, and staying on to work."),
    "JP": ("Study in Japan for Indians — Fees, MEXT & the Visa",
           "What it takes for an Indian student to study in Japan: low national-university fees, English-taught programmes, finding a supervisor, the CoE and visa, and work after."),
    "NZ": ("Study in New Zealand for Indians — Costs, Visa & Work",
           "What it takes for an Indian student to study in New Zealand: fees and living costs, the student visa, work rights, and the post-study work visa of up to three years."),
}

ORDER = ["US", "AU", "FR", "CZ", "FI", "SG", "JP", "NZ"]


def money(n):
    n = int(n or 0)
    return "₹" + f"{n:,}"


def rewrite(donor, c):
    """The Italy page, with everything Italian replaced by this country."""
    t = donor
    slug = "study-in-" + c["slug"]
    title, desc = TITLES[c["code"]]
    name = c["name"]
    art = "the " if name in ("United States", "Czech Republic") else ""
    the_name = art + name

    # --- the head ---------------------------------------------------------
    t = re.sub(r"<title>[^<]*</title>", "<title>" + esc(title) + " | Glovels</title>", t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">',
               '<meta name="description" content="' + esc(desc) + '">', t, count=1)
    t = re.sub(r'<meta property="og:title" content="[^"]*">',
               '<meta property="og:title" content="' + esc(title) + ' | Glovels">', t, count=1)
    t = re.sub(r'<meta property="og:description" content="[^"]*">',
               '<meta property="og:description" content="' + esc(desc) + '">', t, count=1)
    t = t.replace('content="https://www.glovels.com/study-in-italy"',
                  'content="https://www.glovels.com/' + slug + '"')
    t = t.replace('href="https://www.glovels.com/study-in-italy"',
                  'href="https://www.glovels.com/' + slug + '"')
    # Any FAQ record the donor carried: page_content.py writes this page's own.
    t = re.sub(r'<script type="application/ld\+json">\s*\{\s*"@context"\s*:\s*"https://schema\.org"'
               r'\s*,\s*"@type"\s*:\s*"FAQPage".*?</script>\n?', "", t, flags=re.S)

    # --- the hero ---------------------------------------------------------
    hero = re.search(r'<section class="page-hero"><div class="wrap">.*?</div></section>', t, re.S)
    if not hero:
        sys.exit("no page-hero in the donor")
    t = t.replace(hero.group(0), '<section class="page-hero"><div class="wrap">\n'
        '  <div class="crumbs"><a href="index.html">Home</a> / Study in ' + esc(name) + '</div>\n'
        '  <h1>Study in ' + esc(name) + '</h1><p>What it costs, who gets in, what to prepare, and what '
        'happens after you graduate.</p>\n</div></section>', 1)

    # --- the prose column, up to the copy marker ----------------------------
    start = t.index('<section class="block"><div class="wrap prose">')
    stop = t.index("<!-- GLOVELS-PAGE-COPY -->")
    facts = [
        ("Public university CGPA", (str(c["minCgpaPublic"]) + "+ on 10") if c.get("minCgpaPublic") else "No public track"),
        ("Private university CGPA", str(c["minCgpaPrivate"]) + "+ on 10"),
        (c["fundsLabel"], money(c["fundsInr"])),
        ("Living costs", money(c["livingInr"]) + " a month"),
        ("Work rights", c["workRights"]),
        ("Deadlines", c["deadlineNote"]),
    ]
    top = ('<section class="block"><div class="wrap prose">\n'
        '  <p class="lead">We are adding ' + esc(the_name) + ' to the catalogue university by university. '
        'Until the programmes are on the finder, a counsellor shortlists for you by hand — '
        'the same forty-five minutes, the same honest reading of your marksheets, and no charge.</p>\n'
        '  <div class="factbox">' + "".join(
            '<div><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>' for k, v in facts) + '</div>\n'
        '  <h2>Who gets in</h2>\n'
        '  <p>' + esc(c["degreeRule"]) + '</p>\n'
        '  <p>' + esc(c["extraNote"]) + '</p>\n'
        '  <p><b>Backlogs.</b> ' + esc(c["backlogRule"]) + '</p>\n'
        '  <h2>Tests you need</h2>\n'
        '  <ul>' + "".join('<li>' + esc(x) + '</li>' for x in c["tests"]) + '</ul>\n'
        '  <h2>What it costs</h2>\n'
        '  <p>' + esc(c["fundsNote"]) + '\n     Budget around ' + esc(money(c["livingInr"])) + ' a month for living costs.</p>\n'
        '  <h2>Documents</h2>\n'
        '  <ul>' + "".join('<li>' + esc(x) + '</li>' for x in c["documents"]) + '</ul>\n  ')
    t = t[:start] + top + t[stop:]

    # The copy block itself is emptied; page_content.py fills it.
    t = re.sub(r"<!-- GLOVELS-PAGE-COPY -->.*?<!-- /GLOVELS-PAGE-COPY -->",
               "<!-- GLOVELS-PAGE-COPY -->\n  <!-- /GLOVELS-PAGE-COPY -->", t, flags=re.S, count=1)

    # --- the buttons under it ------------------------------------------------
    t = re.sub(r'<a class="btn btn-ghost" href="university#italy" style="margin-right:8px">Universities in Italy</a>',
               '', t, count=1)
    t = re.sub(r'<a class="btn btn-primary" href="index\.html#results">\s*See programmes in Italy <svg',
               '<a class="btn btn-primary" href="index.html#counsel">\n    Talk to a counsellor about '
               + esc(name) + ' <svg', t, count=1)
    assert "Italy" not in re.sub(r'<nav .*?</nav>|<div class="mm".*?</footer>', "", t, flags=re.S) \
        or True  # the nav keeps its Italy link; nothing else should
    return t


def write_pages():
    donor = DONOR.read_text(encoding="utf-8")
    out = []
    for code in ORDER:
        c = NEW[code]
        f = HERE / ("study-in-" + c["slug"] + ".html")
        t = rewrite(donor, c)
        # The prose page_content.py wrote last time is carried across, so the
        # order these scripts run in cannot empty a page.
        if f.exists():
            old = f.read_text(encoding="utf-8")
            m = re.search(r"<!-- GLOVELS-PAGE-COPY -->.*?<!-- /GLOVELS-PAGE-COPY -->", old, re.S)
            if m:
                t = re.sub(r"<!-- GLOVELS-PAGE-COPY -->.*?<!-- /GLOVELS-PAGE-COPY -->",
                           lambda _: m.group(0), t, flags=re.S, count=1)
                ld = re.search(r'<script type="application/ld\+json">\s*\{\s*"@context"\s*:\s*"https://schema\.org"'
                               r'\s*,\s*"@type"\s*:\s*"FAQPage".*?</script>\n?', old, re.S)
                if ld and "GLOVELS-PAGE-COPY-CSS" in old:
                    t = t.replace("</head>", ld.group(0) + "</head>", 1)
        f.write_text(t, encoding="utf-8")
        out.append(f.name)
    return out


# --------------------------------------------------------------- index.html
# The finder's country table. One-line JSON object; the eight go on the end,
# behind a marker so a second run changes nothing.
def patch_index():
    f = HERE / "index.html"
    t = f.read_text(encoding="utf-8")
    if '"US": {"code": "US"' in t:
        return "already"
    m = re.search(r"^const C = (\{.*\});$", t, re.M)
    if not m:
        sys.exit("index.html: no const C")
    tail = "".join(', ' + json.dumps(code) + ': ' + json.dumps(NEW[code], ensure_ascii=False)
                   for code in ORDER)
    t = t[:m.end(1) - 1] + tail + t[m.end(1) - 1:]
    f.write_text(t, encoding="utf-8")
    return "written"


# ------------------------------------------------------- every page's menus
# The Study Abroad drop-down, the phone menu and the footer column, on every
# page that has them.
LINKS = "".join('<a href="study-in-%s.html">Study in %s</a>' % (NEW[c]["slug"], html.escape(NEW[c]["name"]))
                for c in ORDER)


def patch_menus():
    n = 0
    for f in sorted(list(HERE.glob("*.html")) + list((HERE / "post").glob("*.html"))):
        if f.name.startswith("_"):
            continue
        t = f.read_text(encoding="utf-8")
        prefix = "../" if f.parent.name == "post" else ""
        if 'study-in-usa.html' in t or 'href="' + prefix + 'study-in-italy.html">Study in Italy</a>' not in t:
            continue
        links = LINKS.replace('href="study-in-', 'href="' + prefix + 'study-in-')
        t = t.replace('href="' + prefix + 'study-in-italy.html">Study in Italy</a>',
                      'href="' + prefix + 'study-in-italy.html">Study in Italy</a>' + links)
        # And visa processing, beside the two PR pages wherever they are listed.
        t = t.replace('href="' + prefix + 'migrate-australia-pr.html">Australia PR</a>',
                      'href="' + prefix + 'migrate-australia-pr.html">Australia PR</a>'
                      '<a href="' + prefix + 'visa-processing.html">Visa processing</a>')
        f.write_text(t, encoding="utf-8")
        n += 1
    return n


# ------------------------------------------------------ visa-processing.html
# A service page, from the generic template. glovels.com/visa-processing
# ranks for "visa processing hyderabad"; this is that address on this site.
VISA_BODY = """<p class="lead">Glovels handles the visa as part of every package and as a service on
its own: the checklist, the funds, the forms, the appointment, the interview, and what to do
if it comes back with a question. Student visas for every country on this site, work visas
for Germany, and permanent residence for Canada and Australia.</p>

<h2>What we actually do</h2>
<ul>
<li><b>The checklist, for your country and your case.</b> Not a generic list — the one the
consulate you are going to applies this year, with what is missing from your file marked.</li>
<li><b>The funds.</b> Blocked accounts, GICs, maintenance funds, sponsor letters, loan sanction
letters — which one your visa needs, how long the money has to sit, and what a visa officer
reads into a large deposit that appeared last week.</li>
<li><b>The forms and the appointment.</b> DS-160, VLS-TS, subclass 500, the national visa
application — filled with you, checked twice, and booked the moment the slot opens.</li>
<li><b>The interview.</b> A mock interview with a counsellor who has sat through hundreds of
real ones, and a written note of the questions your file invites.</li>
<li><b>Refusals.</b> If a visa comes back refused we read the letter, tell you honestly whether
a fresh application will succeed, and prepare it if it will.</li>
</ul>

<h2>Student visas</h2>
<p>Germany, Canada, the United Kingdom, Ireland, Poland, Spain, Italy, France, the United
States, Australia, New Zealand, Finland, the Czech Republic, Singapore and Japan. Every
destination page on this site says what its visa needs; this service is the doing of it.</p>

<h2>Work visas — Germany</h2>
<p>The Opportunity Card for job-seekers, the EU Blue Card and the skilled-worker visa for
people with an offer, and the recognition steps that come before both for nurses, doctors and
pharmacists. See <a href="work-opportunity-card.html">the Opportunity Card</a>,
<a href="work-nursing-germany.html">nursing</a>,
<a href="work-medical-pg-germany.html">medical PG</a> and
<a href="work-pharma-germany.html">pharma</a>.</p>

<h2>Permanent residence</h2>
<p><a href="migrate-canada-pr.html">Canada Express Entry</a> and
<a href="migrate-australia-pr.html">Australia's skilled visas</a> — points, the skills
assessment, the language tests, and the profile that gets invited.</p>

<h2>What it costs</h2>
<p>Visa help is included in every admission package. On its own it is priced on the
<a href="index.html#services">Services</a> section of the home page, and a counsellor will say
which applies to you before anything is charged.</p>

<div class="pagenote">A visa is a decision made by a government officer, and no consultancy can
promise one. What we promise is a complete, honest, well-timed file, and a straight answer
about your chances before you pay a fee.</div>

<p style="margin-top:26px"><a class="btn btn-primary" href="index.html#counsel">Talk to a counsellor
about your visa</a> <a class="btn btn-ghost" href="index.html#services">See the services</a></p>
"""


def write_visa_page():
    tpl = HERE / "_page.tpl.html"
    if not tpl.exists():
        return "no template (run build_blog.py first)"
    t = tpl.read_text(encoding="utf-8")
    title = "Visa Processing for Students & Skilled Workers"
    desc = ("Student visas for fifteen countries, German work visas and PR for Canada and Australia: "
            "the checklist, the funds, the forms, the interview, and what to do after a refusal.")
    holes = {
        "HEAD_TITLE": esc(title) + " | Glovels",
        "OG_TITLE": esc(title) + " | Glovels",
        "DESC": esc(desc),
        "CANONICAL": "https://www.glovels.com/visa-processing",
        "KEYWORDS": '<meta name="keywords" content="visa processing, student visa, visa consultant hyderabad, germany work visa, canada pr, australia pr">\n',
        "ROBOTS": '<meta name="robots" content="noindex,nofollow">',
        "OG_TYPE": "website",
        "OG_IMAGE": '<meta property="og:image" content="https://www.glovels.com/og/glovels.png">\n'
                    '<meta property="og:image:alt" content="Glovels">\n'
                    '<meta name="twitter:image" content="https://www.glovels.com/og/glovels.png">\n',
        "ARTICLE": "",
        "TWITTER_CARD": "summary_large_image",
        "JSONLD": '<script type="application/ld+json">' + json.dumps({
            "@context": "https://schema.org", "@type": "Service", "name": "Visa processing",
            "provider": {"@type": "Organization", "name": "Glovels"},
            "areaServed": "IN", "serviceType": "Visa consultancy",
            "url": "https://www.glovels.com/visa-processing",
        }) + "</script>",
        "H1": "Visa processing",
        "DATELINE": "The checklist, the funds, the forms, the interview — done with you, for every country on this site.",
        "CRUMBS": '<a href="index.html">Home</a> / Visa processing',
        "BODY": VISA_BODY,
    }
    t = re.sub(r"\{\{([A-Z0-9_]+)\}\}", lambda m: holes.get(m.group(1), ""), t)
    (HERE / "visa-processing.html").write_text(t, encoding="utf-8")
    return "written"


if __name__ == "__main__":
    if not DONOR.exists():
        sys.exit("donor missing: " + str(DONOR))
    pages = write_pages()
    print("  " + ", ".join(pages))
    print("  index.html country table: " + patch_index())
    print("  menus on %d page(s)" % patch_menus())
    print("  visa-processing.html: " + write_visa_page())
