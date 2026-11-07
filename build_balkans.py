#!/usr/bin/env python3
"""
Western Balkans pages (patch 213).

"Albania, Serbia and other European countries where students will be
interested to study as it's near to France or Germany ... Our website should
target these countries as well." — and: "We need to target audience where
ever possible."

    western-balkans                          the hub
    study-in-germany-from-albania            one page per country
    study-in-germany-from-serbia
    study-in-germany-from-bosnia-and-herzegovina
    study-in-germany-from-north-macedonia
    study-in-germany-from-montenegro
    study-in-germany-from-kosovo

Top-level files on purpose: the shared header uses relative links, and the
sitemap walk picks top-level .html up without being told.

Each page is the Germany page's head, header and footer around new copy.
Every figure below is from an official source, linked at the foot of the
page. Change a figure here and run:

    python3 build_balkans.py
"""
import html, json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SHELL = (ROOT / 'study-in-germany.html').read_text(encoding='utf-8')

BLOCKED_YEAR = '€11,904'
BLOCKED_MONTH = '€992'
OPP_CARD_MONTH = '€1,091'
QUOTA = '50,000'

SOURCES = [
    ('Study in Germany (DAAD) — proof of financing', 'https://study-in-germany.de/en/plan-your-studies/requirements/proof-of-financing'),
    ('German Federal Foreign Office — blocked account', 'https://www.auswaertiges-amt.de/en/sperrkonto/388600'),
    ('Federal Employment Agency — Western Balkans Regulation', 'https://www.arbeitsagentur.de/en/node/9178'),
    ('Federal Employment Agency — press release 40/2026 on the quota', 'https://www.arbeitsagentur.de/presse/2026-40-hohe-arbeitsmarktintegration-bei-westbalkan-regelung-ba-plaediert-fuer-unveraendertes-kontingent'),
    ('Make it in Germany — Western Balkans Regulation (PDF)', 'https://www.make-it-in-germany.com/pdf-westbalkanregelung-en'),
]

COUNTRIES = [
    dict(slug='albania', name='Albania', adj='Albanian', flag='🇦🇱', cur='ALL', city='Tirana',
         visa='Apply for the national (D) student visa at the German Embassy in Tirana (Skenderbej Street No. 8). Book early: the Federal Employment Agency reported in October 2026 that it was still working through Western Balkans work applications from Albania received in late July, and student appointments compete for the same desk.',
         note='Albania sends more people to Germany under the Western Balkans Regulation than almost anywhere else, which is why the queue is long. Students are not in that quota, but they share the embassy.',
         lang='German is widely taught in Albanian schools and language centres in Tirana, Durrës and Shkodër — an A2 or B1 certificate before you fly is very achievable.'),
    dict(slug='serbia', name='Serbia', adj='Serbian', flag='🇷🇸', cur='RSD', city='Belgrade',
         visa='Since 9 September 2024 German national visas in Serbia, student visas included, are booked and submitted through VisaMetric in Belgrade rather than directly at the embassy. Book the appointment as soon as your admission letter arrives.',
         note='Serbian students already have a Bologna-system bachelor (180 or 240 ECTS), so most German master’s programmes read your degree directly — no bridge year.',
         lang='Goethe-Institut Belgrade and many private schools run intensive German courses; plan A2 before you fly and B1 in year one.'),
    dict(slug='bosnia-and-herzegovina', name='Bosnia and Herzegovina', adj='Bosnian', flag='🇧🇦', cur='BAM', city='Sarajevo',
         visa='Apply for the national (D) student visa at the German Embassy in Sarajevo. Appointments are released in batches — check weekly once you have your admission letter.',
         note='The convertible mark is pegged to the euro (1 EUR ≈ 1.96 BAM), so budgeting for Germany is unusually predictable.',
         lang='German is the most common second foreign language in Bosnian schools; many applicants start with A2 already.'),
    dict(slug='north-macedonia', name='North Macedonia', adj='North Macedonian', flag='🇲🇰', cur='MKD', city='Skopje',
         visa='Apply for the national (D) student visa at the German Embassy in Skopje. The Federal Employment Agency reported same-day processing for Western Balkans work applications from North Macedonia in October 2026, so the system is moving.',
         note='An EU candidate country with Bologna degrees: your bachelor is read in ECTS, which makes German admissions straightforward.',
         lang='German language courses run in Skopje, Bitola and Tetovo; the Goethe certificate is accepted by every German university.'),
    dict(slug='montenegro', name='Montenegro', adj='Montenegrin', flag='🇲🇪', cur='EUR', city='Podgorica',
         visa='Apply for the national (D) student visa at the German Embassy in Podgorica.',
         note='Montenegro already uses the euro, so your blocked account, rent and fees are in the currency you earn and save in — no exchange-rate surprise.',
         lang='Courses are fewer than in larger capitals; online Goethe-certified courses are a good route to A2 before you fly.'),
    dict(slug='kosovo', name='Kosovo', adj='Kosovar', flag='🇽🇰', cur='EUR', city='Pristina',
         visa='Apply for the national (D) student visa at the German Embassy in Pristina. Kosovo has had visa-free short stays in the Schengen area since 1 January 2024, but study longer than 90 days still needs the D visa.',
         note='Kosovo uses the euro, so every German cost on this page is already in your currency.',
         lang='German is in high demand in Pristina and Prizren and courses are easy to find; the Federal Employment Agency noted in October 2026 that Kosovo work applications from March were still in process, so start every embassy step early.'),
]

ESC = html.escape


def shell(title, desc, url, body, faq):
    head_end = SHELL.index('<section class="page-hero">')
    foot = SHELL[SHELL.index('<footer class="site">'):]
    head = SHELL[:head_end]
    head = head.replace('<html lang="en-IN">', '<html lang="en">')
    head = re.sub(r'<title>.*?</title>', '<title>' + ESC(title) + '</title>', head, count=1)
    head = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m.group(1) + ESC(desc), head, count=1)
    head = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + ESC(title), head, count=1)
    head = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m.group(1) + ESC(desc), head, count=1)
    head = re.sub(r'(<meta property="og:url" content=")[^"]*', lambda m: m.group(1) + url, head, count=1)
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}
    head = re.sub(r'<script type="application/ld\+json">\{"@context": "https://schema.org", "@type": "FAQPage".*?</script>',
                  lambda m: '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>', head, count=1, flags=re.S)
    if 'link rel="canonical"' in head:
        head = re.sub(r'(<link rel="canonical" href=")[^"]*', lambda m: m.group(1) + url, head, count=1)
    return head + body + '\n' + foot


def faq_html(faq):
    return '<div class="pfaq">' + ''.join(
        '<details><summary>' + ESC(q) + '</summary><p>' + ESC(a) + '</p></details>' for q, a in faq) + '</div>'


def sources_html():
    return ('<h2>Sources</h2><ul class="bsrc">' + ''.join(
        '<li><a href="' + u + '" rel="noopener" target="_blank">' + ESC(t) + '</a></li>' for t, u in SOURCES)
        + '</ul><p class="bsmall">Figures checked 1 November 2026. Rules change — a counsellor confirms the current position on your call.</p>')


STYLE = '''<style>
.bgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:18px 0 8px}
.bcard{border:1px solid #dfe6ee;border-radius:14px;padding:16px 18px;background:#fff}
.bcard h3{margin:0 0 6px;font-size:1.05rem}
.bcard p{margin:0;color:#41556b;font-size:.95rem}
.bcta{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 6px}
.bflags a{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
.bflags .fl{font-size:1.6rem}
.bsrc li{margin:4px 0}
.bsmall{font-size:.85rem;color:#5a6b7d}
</style>'''


def ctas():
    return ('<div class="bcta"><a class="btn btn-primary" href="/#book">Schedule a free call</a>'
            '<a class="btn btn-ghost" href="/find-university?country=Germany">Find a university in Germany</a></div>')


def routes_html():
    return f'''<h2>Three ways into Germany</h2>
<div class="bgrid">
 <div class="bcard"><h3>Study</h3><p>Admission to a German university, then a national (D) student visa. Public universities charge little or no tuition. You prove living costs with a blocked account of {BLOCKED_YEAR} a year ({BLOCKED_MONTH} a month in 2026), and may work 20 hours a week in term.</p></div>
 <div class="bcard"><h3>Work — the Western Balkans Regulation</h3><p>Citizens of Albania, Bosnia and Herzegovina, Kosovo, Montenegro, North Macedonia and Serbia can take any job in Germany with a job offer, without having their qualifications recognised. The quota has been {QUOTA} approvals a year since June 2024; the government has said it plans to halve it from 2027.</p></div>
 <div class="bcard"><h3>Look for work — the Opportunity Card</h3><p>Up to a year in Germany to find a job, for people with a recognised degree or vocational qualification. Proof of funds is {OPP_CARD_MONTH} a month. Points come from qualifications, German or English, experience and age.</p></div>
</div>'''


def country_page(c):
    title = f'Study in Germany from {c["name"]} — Visa & Costs | Glovels'
    desc = f'How {c["adj"]} students get into German universities: the blocked account ({BLOCKED_YEAR} a year), the D visa in {c["city"]}, the Western Balkans Regulation and what it costs.'
    url = 'https://www.glovels.com/study-in-germany-from-' + c['slug']
    faq = [
        (f'Can I study in Germany from {c["name"]} without a visa?',
         'Short visits of up to 90 days in any 180 are visa-free. A degree programme is longer than that, so you need a national (D) student visa before you travel.'),
        ('How much money do I need?',
         f'For the visa you show {BLOCKED_YEAR} for the first year, usually as a blocked account that pays you {BLOCKED_MONTH} a month. Tuition at public universities is free or close to it; you pay a semester contribution of roughly €150–€350.'),
        ('Is the Western Balkans Regulation for students?',
         'No — it is a work route that needs a job offer, and approvals count against an annual quota. Students apply for a student visa, which is outside that quota. Some families use both: one person studies, another works.'),
        ('Do I need German if my course is in English?',
         'Not for admission to an English-taught programme. Yes for part-time work, housing and staying after graduation — A2 before you fly and B1 in the first year is the pattern that works.'),
        ('Is the call really free?',
         'Yes. A thirty-minute call with a counsellor costs nothing and commits you to nothing. We read your grades and tell you which programmes they open.'),
    ]
    body = f'''{STYLE}
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="/">Home</a> / <a href="western-balkans.html">Western Balkans</a> / {ESC(c["name"])}</div>
  <h1>{c["flag"]} Study in Germany from {ESC(c["name"])}</h1><p>A two-hour flight, no tuition at public universities, and a degree the whole EU recognises.</p>
</div></section>
<section class="block"><div class="wrap prose">
  <p class="lead">Germany is close to {ESC(c["name"])} in every way that matters for a student: you can fly home for a long weekend, the time zone is the same, and the university system reads your grades in the same ECTS credits your own universities use. {ESC(c["note"])}</p>
  <div class="factbox"><div><span>Blocked account 2026</span><b>{BLOCKED_YEAR}/yr</b></div><div><span>Paid out monthly</span><b>{BLOCKED_MONTH}</b></div><div><span>Public tuition</span><b>€0 – low</b></div><div><span>Work in term</span><b>20 h/week</b></div></div>
  {ctas()}
  {routes_html()}
  <h2>The visa, from {ESC(c["city"])}</h2>
  <p>{ESC(c["visa"])}</p>
  <h2>German</h2>
  <p>{ESC(c["lang"])}</p>
  <h2>Steps, in order</h2>
  <ol>
   <li><b>Free call with a counsellor</b> — we read your grades and shortlist programmes they open.</li>
   <li><b>Apply</b> — directly or through uni-assist, depending on the university. Winter intake usually closes 15 July, summer 15 January.</li>
   <li><b>Blocked account</b> — open it once you have an admission letter; it takes a few days.</li>
   <li><b>Visa appointment</b> in {ESC(c["city"])} — book the moment the admission letter arrives.</li>
   <li><b>Fly, register your address, enrol.</b></li>
  </ol>
  <p>Prices on this site follow the country and currency in the header — choose {ESC(c["name"])} and {ESC(c["cur"])} or euros.</p>
  <h2>Questions we are asked</h2>
  {faq_html(faq)}
  {ctas()}
  {sources_html()}
</div></section>

<div class="cta-band"><div class="wrap">
  <h2>Thirty minutes, free, no obligation.</h2>
  <p>Pick a time that suits you — our calls run in the morning, Central European Time.</p>
  <a class="btn btn-green" href="/#book">Schedule a free call <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></a>
</div></div>
'''
    return shell(title, desc, url, body, faq)


def hub_page():
    title = 'Study in Germany from the Western Balkans | Glovels'
    desc = f'Germany for students from Albania, Serbia, Bosnia and Herzegovina, North Macedonia, Montenegro and Kosovo: study, the Western Balkans Regulation, the {BLOCKED_YEAR} blocked account.'
    url = 'https://www.glovels.com/western-balkans'
    faq = [
        ('Which countries does the Western Balkans Regulation cover?',
         'Albania, Bosnia and Herzegovina, Kosovo, Montenegro, North Macedonia and Serbia.'),
        ('Why Germany rather than further away?',
         'It is close, in the same time zone, reads your degree in ECTS credits, and public universities charge little or no tuition. Family is a short flight away and so is home.'),
        ('Does Glovels charge for the first call?',
         'No. The call is free. You only pay if you choose one of our application packages afterwards.'),
    ]
    cards = ''.join(
        f'<div class="bcard bflags"><a href="study-in-germany-from-{c["slug"]}.html"><span class="fl" aria-hidden="true">{c["flag"]}</span>'
        f'<span><b>{ESC(c["name"])}</b><br><span class="bsmall">Visa in {ESC(c["city"])} · {ESC(c["cur"])}</span></span></a></div>'
        for c in COUNTRIES)
    body = f'''{STYLE}
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="/">Home</a> / Western Balkans</div>
  <h1>Study in Germany from the Western Balkans</h1><p>Close to home, no tuition at public universities, and a route to work afterwards.</p>
</div></section>
<section class="block"><div class="wrap prose">
  <p class="lead">For a student from Tirana, Belgrade, Sarajevo, Skopje, Podgorica or Pristina, Germany is a two-hour flight, not a twelve-hour one. Your bachelor already speaks ECTS, the time zone is yours, and Germany runs a work route written for your region alone.</p>
  <h2>Choose your country</h2>
  <div class="bgrid">{cards}</div>
  {ctas()}
  {routes_html()}
  <h2>Questions we are asked</h2>
  {faq_html(faq)}
  {sources_html()}
</div></section>
<div class="cta-band"><div class="wrap">
  <h2>Not sure which route fits?</h2>
  <p>A free thirty-minute call with a counsellor. Study, work or both — we will tell you what your profile opens.</p>
  <a class="btn btn-green" href="/#book">Schedule a free call <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></a>
</div></div>
'''
    return shell(title, desc, url, body, faq)


def main():
    (ROOT / 'western-balkans.html').write_text(hub_page(), encoding='utf-8')
    for c in COUNTRIES:
        (ROOT / f'study-in-germany-from-{c["slug"]}.html').write_text(country_page(c), encoding='utf-8')
    # A link from the Germany page, so the new pages are reachable by a reader
    # and a crawler, not only by the sitemap.
    g = ROOT / 'study-in-germany.html'
    s = g.read_text(encoding='utf-8')
    mark = '<!-- GLOVELS-BALKANS-LINK -->'
    if mark not in s:
        link = (mark + '<p class="pagenote">From Albania, Serbia, Bosnia and Herzegovina, North Macedonia, Montenegro or Kosovo? '
                '<a href="western-balkans.html">Read the Western Balkans guide</a> — the routes and the visa desk are different for you.</p>\n  ')
        s = s.replace('<!-- GLOVELS-PAGE-COPY -->', link + '<!-- GLOVELS-PAGE-COPY -->', 1)
        g.write_text(s, encoding='utf-8')
    print('wrote', 1 + len(COUNTRIES), 'pages')


if __name__ == '__main__':
    main()
