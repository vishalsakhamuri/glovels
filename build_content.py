"""
The home page's own content, lifted out of the HTML so it can be edited.

The marketing pages are generated from `Glovels_Content_Master.xlsx`, which
means every price change, every new package and every corrected number is a
developer job today. This pulls the four blocks that actually change — the
packages, the headline numbers, the FAQ and the testimonials — out of
`index.html` and writes them to `content.json`, which the server seeds into the
database on first run and which counsellors then edit from the Home page screen
in the operations site.

It is an extractor, not a source of truth. Run it against the generated page
and it produces the same JSON every time; edit the JSON afterwards and it is
the database that wins, not this file.

    python3 build_content.py
"""

import html
import json
import os
import re
import sys
from pathlib import Path

import page_text
import writing_bank

HERE = Path(__file__).resolve().parent
INDEX = HERE / "index.html"
OUT = HERE / "content.json"


DUMMY_CHIP = re.compile(r'<span class="dummy-chip".*?</span>', re.S)


def unesc(s):
    """
    Back to plain text. The editor shows text, not entities.

    The DUMMY chip goes first and by itself: it is a marker the build adds, not
    something anyone typed, and stripping tags without removing it leaves the
    word DUMMY welded onto the end of the sentence.
    """
    return html.unescape(re.sub(r"<[^>]+>", "", DUMMY_CHIP.sub("", s or ""))).strip()


def dummy(block):
    """A DUMMY chip means the number is a placeholder nobody has confirmed."""
    return "dummy-chip" in block


# --------------------------------------------------------------------- packages

PLEDGE = re.compile(
    r'<div class="pledge (\w+)"><b>(.*?)</b>(.*?)<small><a href="([^"]*)">(.*?)</a></small></div>',
    re.S,
)


def page_data(s):
    """
    The page already carries its own data.

    `const D = {...}` near the bottom of index.html is what the finder, the
    checkout sheet and the package cards are all driven from — the build put
    it there from the workbook. Reading that is far better than scraping the
    rendered markup: every field is already separated, typed and named.
    """
    i = s.find("const D = {")
    if i < 0:
        sys.exit("index.html has no `const D` block — has the build changed?")
    j = s.find("\n", i)
    return json.loads(s[i + len("const D = "):j].rstrip(";"))


def ai_block(s):
    """The studio's chip lists, read from the page the same way as `const D`."""
    i = s.find("const AI = {")
    if i < 0:
        sys.exit("index.html has no `const AI` block — has the build changed?")
    j = s.find("\n", i)
    return json.loads(s[i + len("const AI = "):j].rstrip(";"))


def finder_block(s):
    """The finder's settings, the budget bands, the trending chips, the number."""
    d = page_data(s)
    st = d.get("settings", {})

    i = s.find("const TRENDING = ")
    trending = []
    if i >= 0:
        trending = json.loads(s[i + len("const TRENDING = "):s.find("\n", i)].rstrip(";"))

    i = s.find("const BANDS = ")
    bands = st.get("bands", [])
    if i >= 0:
        bands = json.loads(s[i + len("const BANDS = "):s.find("\n", i)].rstrip(";"))

    # The number lives in a wa.me link rather than in the settings, because it
    # was written into the markup of forty pages by hand.
    m = re.search(r"wa\.me/(\d+)", s)
    tel = re.search(r"\+91[\d ]{8,}", s)
    mail = re.search(r"mailto:([a-z0-9._%+-]+@[a-z0-9.-]+)", s)

    mode = re.search(r'const MODE\s*=\s*"([a-z]+)"', s)
    badge = re.search(r'const BADGE\s*=\s*\{(.*?)\}', s)
    badges = {}
    if badge:
        for k, v in re.findall(r"(\w+)\s*:\s*'([^']*)'", badge.group(1)):
            badges[k] = v

    return {
        "gate": mode.group(1) if mode else "gated",
        "badges": badges,
        "browsePublic": st.get("browsePublic", 3),
        "browsePrivate": st.get("browsePrivate", 2),
        "cgpaFull": st.get("cgpaFull", 7.5),
        "cgpaPartial": st.get("cgpaPartial", 6),
        "fx": st.get("fx", {"INR": 1}),
        "bands": bands,
        "trending": trending,
        "contact": {
            "whatsapp": m.group(1) if m else "",
            "phone": tel.group(0).strip() if tel else "",
            "email": mail.group(1) if mail else "",
        },
    }


def packages(s):
    D = page_data(s)
    raw = D.get("packages") or []
    if not raw:
        sys.exit("`const D` has no packages.")

    i = s.find('data-pane="study"')
    start = s.rfind("<section", 0, i)
    seg = s[start:s.find("</section>", i)]

    tabs = [{"key": k, "label": unesc(l)} for k, l in re.findall(
        r'data-ptab="(\w+)"[^>]*>(?:<svg.*?</svg>)?([^<]*)<', seg, re.S)]
    head = re.search(r'<div class="sec-head">\s*<span class="eyebrow">.*?</svg>\s*(.*?)</span>\s*'
                     r"<h2>(.*?)</h2>", seg, re.S)

    # Two things live only in the markup: which card is visually highlighted,
    # and the small print under the "priced after we assess" cards.
    cards = {}
    for m in re.finditer(r'<article class="card card-hover card-stack pcard([^"]*)">(.*?)</article>',
                         seg, re.S):
        b, cls = m.group(2), m.group(1)
        title = unesc(re.search(r"<h3>(.*?)</h3>", b, re.S).group(1))
        pl = PLEDGE.search(b)
        quote_small = re.search(r'<div class="pquote">.*?<small>(.*?)</small>', b, re.S)
        href = re.search(r'<a class="btn[^"]*" href="([^"]*)"', b)
        cards[title] = {
            "featured": "featured" in cls,
            "primary": "btn-primary" in (re.search(r'<(?:button|a) class="(btn[^"]*)"', b).group(1)
                                         if re.search(r'<(?:button|a) class="(btn[^"]*)"', b) else ""),
            "pledgeHref": pl.group(4) if pl else "",
            "pledgeLink": unesc(pl.group(5)) if pl else "",
            "pledgeTone": pl.group(1) if pl else "",
            "quoteSmall": unesc(quote_small.group(1)) if quote_small else "",
            "ctaHref": href.group(1) if href else "",
        }

    items = []
    for n, p in enumerate(raw):
        extra = cards.get(unesc(p.get("name", "")), {})
        sell = bool(p.get("buyable"))
        items.append({
            "id": p.get("id") or f"pkg-{n + 1}",
            "tab": p.get("tab") or "study",
            "sort": n + 1,
            "active": True,
            "featured": extra.get("featured", False),
            "primary": extra.get("primary", False),
            "ribbon": unesc(p.get("ribbon")),
            "title": unesc(p.get("name")),
            "desc": unesc(p.get("desc")),
            # What the package is worth to a student, and what the server hands
            # out: the number of gated public-university names it unlocks.
            "unlocks": int(p.get("publicUnis") or 0),
            "features": [unesc(f) for f in (p.get("features") or [])],
            "sell": sell,
            "priceInr": int(p.get("priceInr") or 0) if sell else 0,
            "priceFrom": unesc(p.get("pricePrefix")) or "From",
            "priceNote": unesc(p.get("priceNote")),
            "quote": unesc(p.get("quoteNote")),
            "quoteSmall": extra.get("quoteSmall", ""),
            "cta": unesc(p.get("cta")),
            "ctaHref": extra.get("ctaHref", ""),
            # The line a student ticks at checkout. It is a promise, so it is
            # editable — and empty means no tick box, not an empty tick box.
            "consent": unesc(p.get("consent")),
            "pledge": {
                "tone": p.get("pledgeTone") or extra.get("pledgeTone") or "green",
                "title": unesc(p.get("pledgeTitle")),
                "body": unesc(p.get("pledgeBody")),
                "href": extra.get("pledgeHref") or unesc(p.get("pledgeTerms")),
                "linkText": extra.get("pledgeLink") or "Full terms",
            } if p.get("pledgeTitle") or p.get("pledgeBody") else None,
        })

    return {
        "eyebrow": unesc(head.group(1)) if head else "",
        "heading": unesc(head.group(2)) if head else "",
        "tabs": tabs,
        "items": items,
    }


# --------------------------------------------------------------------- services

def services(s):
    """
    The a-la-carte grid: LOR, SOP, CV, visa, test prep, language, loan.

    Like the packages, this is already data in the page — `const SERVICES` —
    put there by the build. Reading that beats scraping the rendered cards.
    """
    i = s.find("const SERVICES = [")
    if i < 0:
        sys.exit("index.html has no `const SERVICES` block — has the build changed?")
    j = s.find("\n", i)
    raw = json.loads(s[i + len("const SERVICES = "):j].rstrip(";"))

    # The category chips above the grid: key, label, and the colour the build
    # chose for each. Read from the markup because that is where they live.
    tabs = []
    for m in re.finditer(r'data-cat="(\w+)"[^>]*?style="--tabc:(#[0-9a-f]+)"[^>]*>'
                         r'(?:<svg.*?#i-([\w-]+).*?</svg>)?<span>([^<]*)</span>', s, re.S):
        tabs.append({"key": m.group(1), "colour": m.group(2),
                     "icon": m.group(3) or "star", "label": unesc(m.group(4))})

    items = []
    for n, x in enumerate(raw):
        cta = x.get("cta") or {}
        items.append({
            "id": x.get("id") or f"svc-{n + 1}",
            "sort": n + 1,
            "active": True,
            "name": unesc(x.get("name")),
            "desc": unesc(x.get("desc")),
            # The line under the description: how long it takes.
            "meta": unesc(x.get("meta")),
            "cats": [c for c in (x.get("cats") or []) if c],
            "posTop": int(x.get("posTop") or 0),
            "isFree": bool(x.get("isFree")),
            "priceInr": int(x.get("priceInr") or 0),
            # Shown instead of a number — "from ₹X", "priced per case".
            "priceLabel": unesc(x.get("priceLabel")),
            "badge": x.get("badge") or "",
            # Which AI writer the "Try the AI draft" button opens, if any.
            "ai": x.get("ai") or "",
            "ctaLabel": unesc(cta.get("label")) if cta else "",
            "ctaHref": cta.get("href") or "",
            "ctaGreen": bool(x.get("ctaGreen")),
            # Kept whole rather than modelled: the level pricing on language
            # courses and the partner links. Nothing in the editor touches
            # them, and dropping them would quietly delete a price list.
            "levels": x.get("levels") or [],
            "partners": x.get("partners") or [],
        })

    return {"tabs": tabs, "items": items}


# ------------------------------------------------------------ the other blocks

def stats(s):
    grid = re.search(r'<div class="stat-grid">(.*?)</div></div>\s*</section>', s, re.S)
    if not grid:
        grid = re.search(r'<div class="stat-grid">(.*?)</div>\s*</div>', s, re.S)
    out = []
    for m in re.finditer(r'<div class="stat"><span class="num">(.*?)</span>'
                         r'<span class="lbl">(.*?)</span></div>', grid.group(1), re.S):
        out.append({"num": unesc(m.group(1)), "label": unesc(m.group(2)),
                    "dummy": dummy(m.group(2))})
    return out


def faq(s):
    return [{"q": unesc(m.group(1)), "a": unesc(m.group(2)), "dummy": dummy(m.group(1))}
            for m in re.finditer(r'<details class="faq"><summary>(.*?)</summary>'
                                 r"<p>(.*?)</p></details>", s, re.S)]


def testimonials(s):
    out = []
    for m in re.finditer(r'<article class="card card-hover card-stack tcard">(.*?)</article>',
                         s, re.S):
        b = m.group(1)
        g = lambda p: (re.search(p, b, re.S).group(1) if re.search(p, b, re.S) else "")
        out.append({
            "route": unesc(g(r'<span class="route">(.*?)</span>')),
            "verified": "vadm" in b,
            "quote": unesc(g(r"<blockquote>(.*?)</blockquote>")),
            "name": unesc(g(r'<span class="av">.*?</span><span><b>(.*?)</b>')),
            "where": unesc(g(r"<b>.*?</b><span>(.*?)</span>")),
            "dummy": dummy(b),
        })
    return out


def carry_over(doc):
    """Keep what the office wrote and this script cannot see."""
    try:
        was = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        return doc                      # no previous file: nothing to keep

    def merge_list(new_items, old_items, key="id"):
        by_id = {x.get(key): x for x in old_items if isinstance(x, dict)}
        for item in new_items:
            prev = by_id.get(item.get(key))
            if not prev:
                continue
            for k, v in prev.items():
                if k not in item:
                    item[k] = v

    for block in ("packages", "services"):
        if isinstance(doc.get(block), dict) and isinstance(was.get(block), dict):
            merge_list(doc[block].get("items") or [], was[block].get("items") or [])

    for k, v in was.items():
        if k not in doc:
            doc[k] = v
    return doc


def main():
    s = INDEX.read_text(encoding="utf-8")
    doc = {
        "packages": packages(s),
        "stats": stats(s),
        "faq": faq(s),
        "testimonials": testimonials(s),
        "services": services(s),
        # What the SOP/LOR studio writes with. The chips come out of the page so
        # the label a student ticks and the phrase the draft uses cannot drift
        # apart; the sentences around them are authored in writing_bank.py.
        "writing": writing_bank.bank(ai_block(s)),
        # How the finder behaves and how to reach the office. Read out of the
        # page's own settings block so the defaults are exactly what the site
        # shipped with.
        "finder": finder_block(s),
        # Everything else on the page: headings, paragraphs, button labels, the
        # form's own words, the footer, the page title and meta description.
        "text": page_text.extract(s),
    }

    for name, n in [("packages", len(doc["packages"]["items"])), ("stats", len(doc["stats"])),
                    ("faq", len(doc["faq"])), ("testimonials", len(doc["testimonials"])),
                    ("lines of text", len(doc["text"])),
                    ("services", len(doc["services"]["items"])),
                    ("SOP openings", len(doc["writing"]["sop"]["openings"])),
                    ("SOP signals", len(doc["writing"]["sop"]["signals"])),
                    ("LOR signals", len(doc["writing"]["lor"]["signals"])),
                    ("budget bands", len(doc["finder"]["bands"])),
                    ("trending chips", len(doc["finder"]["trending"]))]:
        if not n:
            sys.exit(f"REFUSED: extracted 0 {name} from index.html. That is a broken pattern, "
                     f"not an empty page — writing this would blank the home page.")

    # Anything the office wrote that this script cannot read back out of
    # index.html.
    #
    # The package terms — the guarantee, what voids it, how to claim — are
    # authored in the Home page screen and live nowhere in the markup, so a
    # rebuild wrote a packages block without them and the Refund page's
    # per-package terms silently emptied. The page still loaded. The guarantee
    # the Boarding Pass card sells just stopped being written down anywhere.
    #
    # So: a field present in the file and absent from the extraction is kept,
    # matched by id. Extraction wins wherever it has something to say.
    doc = carry_over(doc)

    text = json.dumps(doc, indent=1, ensure_ascii=False)
    tmp = OUT.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, OUT)

    print(f"content.json · {len(doc['packages']['items'])} packages, {len(doc['stats'])} numbers, "
          f"{len(doc['faq'])} FAQ, {len(doc['testimonials'])} testimonials, "
          f"{len(doc['text'])} lines of text, {len(doc['services']['items'])} services, "
          f"{len(doc['writing']['sop']['signals'])}+{len(doc['writing']['lor']['signals'])} "
          f"writing chips")
    for p in doc["packages"]["items"]:
        print(f"   {p['tab']:<8} {p['id']:<18} "
              f"{('₹' + format(p['priceInr'], ',')) if p['sell'] else 'on request':<12} {p['title']}")


if __name__ == "__main__":
    main()
