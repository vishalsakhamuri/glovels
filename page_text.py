"""
Every word on the home page, addressed so it can be edited.

The four blocks with real structure — packages, numbers, FAQ, testimonials —
have their own editors. This is everything else: the hero headline, the section
headings, the paragraphs, the button labels, the form's own words, the footer,
the page title and the meta description. A counsellor should be able to fix a
sentence on the home page without a developer, and "a sentence" is most of the
page.

The hard part is the address. A line has to keep the same key when somebody
edits the line next to it, and it must be computable identically in Python
here and in JavaScript in the browser, because the browser is what applies the
override. So the key is content-addressed:

    section | element | fnv1a-32 of the original text | which occurrence

Content-addressed keys have a property that matters more than tidiness: if the
marketing pages are rebuilt and a sentence comes out different, the override
for the old sentence simply stops matching. It does not silently paste last
month's wording over new copy. The operations screen shows those as orphaned
so somebody can decide, which is the right place for that decision.
"""

import html
import re
from html.parser import HTMLParser

# Text inside these never becomes editable: it is code, it is decoration, or it
# belongs to a block that has its own editor and would be edited twice.
# <head> is deliberately NOT here: the page title and the meta description are
# copy, and they are the two lines that decide what Google shows.
SKIP_TAGS = {"script", "style", "svg", "noscript", "template"}
SKIP_SELECTORS = [
    ("id", "packages"),      # the packages editor owns it
    ("class", "stat-grid"),  # the numbers editor
    ("class", "faq"),        # the FAQ editor
    ("class", "tcard"),      # the testimonials editor
    ("class", "dummy-chip"), # a build marker, not copy
]

# Attributes worth editing. A placeholder is copy; an href is not.
#
# A TUPLE, not a set. Two of these on one element are emitted in this order and
# the browser walks them in the same order; a set would iterate in whatever
# order it liked and the keys would stop matching between the two.
TEXT_ATTRS = ("placeholder", "alt", "title", "aria-label")

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


def fnv1a(text):
    """
    FNV-1a, 32-bit, as an 8-character hex string.

    Chosen because it is four lines in any language and cannot drift between
    the two implementations. It is not a security hash and is not used as one.
    """
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def normalise(s):
    """What the browser will see: entities resolved, whitespace collapsed."""
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def worth_editing(s):
    """
    Not every text node is copy.

    A bare separator, a single bullet, a lone digit inside a badge — offering
    those in a list of 300 editable lines makes the real sentences harder to
    find, and editing them does nothing anybody wanted.
    """
    if len(s) < 2:
        return False
    if not re.search(r"[A-Za-zÀ-ɏ]", s):    # no letters at all
        return False
    if re.fullmatch(r"[\W\d_]+", s):
        return False
    return True


class Walker(HTMLParser):
    """
    A single pass over the document, in reading order.

    The browser walks the same nodes in the same order with a TreeWalker, so
    the occurrence counters line up. That is the only thing the two
    implementations have to agree on, and it is why both skip exactly the same
    containers.
    """

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack = []          # open elements: (tag, attrs)
        self.items = []
        self.counts = {}
        self.in_title = False
        self.sections = 0        # <section> without an id still needs an address
        self.labels = {}         # section -> the heading a person would recognise
        self.heading = None

    # -- where am I ------------------------------------------------------
    def section(self):
        for tag, attrs in reversed(self.stack):
            if tag == "section":
                return attrs.get("id") or attrs.get("data-sec") or "section"
            if tag in ("header", "footer"):
                return tag
        return "page"

    def skipping(self):
        for tag, attrs in self.stack:
            if tag in SKIP_TAGS:
                return True
            for attr, want in SKIP_SELECTORS:
                v = attrs.get(attr, "")
                if attr == "id" and v == want:
                    return True
                if attr == "class" and want in v.split():
                    return True
        return False

    def element(self):
        return self.stack[-1][0] if self.stack else "body"

    def add(self, kind, text, note=""):
        text = normalise(text)
        if not worth_editing(text):
            return
        sec = self.section()
        base = f"{sec}|{self.element() if kind == 'text' else kind}|{fnv1a(text)}"
        n = self.counts.get(base, 0)
        self.counts[base] = n + 1
        self.items.append({
            "key": f"{base}|{n}",
            "section": sec,
            "kind": kind,
            "element": self.element(),
            "original": text,
            "note": note,
        })

    # -- the parser ------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "section" and not a.get("id"):
            self.sections += 1
            a["data-sec"] = "section-%d" % self.sections
        self.stack.append((tag, a))              # void elements too, so their
                                                 # attributes are addressable
        if tag == "title":
            self.in_title = True
        if tag in ("h1", "h2") and not self.skipping():
            self.heading = self.section()

        if not self.skipping():
            if tag == "meta" and a.get("name") == "description":
                self.add("meta-description", a.get("content", ""),
                         "Google shows this under the page title in search results.")
            for attr in TEXT_ATTRS:
                if a.get(attr):
                    self.add("attr:" + attr, a[attr], f"the {attr} on a <{tag}>")

        if tag in VOID:
            self.stack.pop()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1][0] == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.heading:
            t = normalise(data)
            if t and self.heading not in self.labels:
                self.labels[self.heading] = t[:70]
            self.heading = None
        if self.in_title:
            self.add("title", data, "The browser tab, and the blue line in Google.")
            return
        if self.skipping():
            return
        self.add("text", data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")


def extract(html_text):
    w = Walker()
    w.feed(html_text)
    w.close()

    # A section is easier to find by what it says than by what it is called.
    for i in w.items:
        i["sectionLabel"] = w.labels.get(i["section"], "")

    # Entity refs arrive as separate callbacks, which would split "Study &
    # Work" into three items. Rejoining them is not worth the complexity —
    # instead drop the fragments that are only an entity.
    return [i for i in w.items if i["original"] not in ("&", "&amp;", "&nbsp;")]


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path

    items = extract(Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")
                    .read_text(encoding="utf-8"))
    by = {}
    for i in items:
        by.setdefault(i["section"], []).append(i)
    for sec, rows in by.items():
        print(f"{sec}: {len(rows)}")
    print(f"\n{len(items)} editable lines")
    print(json.dumps(items[:6], indent=1, ensure_ascii=False))
