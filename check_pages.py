#!/usr/bin/env python3
"""
Does every page still run?

Three checks, all of them there because the same three failures happened for
real and the build reported success anyway.

  1. Every inline <script> parses. `const acct` was inserted twice into
     index.html by a patch that re-applied itself, and the SyntaxError killed
     every script on the home page — the finder, the packages, the checkout —
     while the build printed "3 applied".

  2. No function is declared twice in one scope. login.html carried three
     copies of forgotPassword(): the working one that asks the server for a
     reset link, shadowed by two stale ones telling students that password
     reset was not connected. The last declaration wins, silently.

  3. No function declaration is being awaited. `await async function
     loadEnquiries() {` is what a paste looks like when it lands inside another
     function and swallows the rest of it — chat.html had four. It parses.

  4. The head of an indexable page is one somebody would click. A title in the
     window Google prints, a description in the window Google prints, no
     `&amp;amp;` — the tab said "IELTS, TOEFL &amp; PTE" on three pages — and
     the title, og:title and twitter:title all saying the same thing. Every one
     of these was wrong on a live page and every one of them is invisible from
     inside the site: nothing renders differently, the build passes, and the
     only place it shows is a search result nobody at Glovels is looking at.

Run on its own:  python3 check_pages.py
Or from a build: check_pages.run() raises SystemExit on the first failure.
"""

import html as _html
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).parent

# Inline scripts only. A block with src= has no body, and JSON-LD is data.
BLOCK = re.compile(
    r'<script(?![^>]*\bsrc=)(?![^>]*\btype\s*=\s*"application/(?:ld\+)?json")'
    r'([^>]*)>([\s\S]*?)</script>')

AWAITED_DECL = re.compile(r'await\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(')

# The windows Google actually prints. Not maximums: under them the space is
# wasted, over them the text is cut off mid-word. Generous at the bottom
# because a short legal-page title is a deliberate choice, and hard at the top
# because 70 characters is truncated whoever wrote it.
TITLE_MIN, TITLE_MAX = 20, 70
DESC_MIN, DESC_MAX = 120, 175

TAG = {
    'title': r'<title>(.*?)</title>',
    'description': r'<meta name="description" content="(.*?)"',
    'og:title': r'<meta property="og:title" content="(.*?)"',
    'og:description': r'<meta property="og:description" content="(.*?)"',
    'twitter:title': r'<meta name="twitter:title" content="(.*?)"',
    'twitter:description': r'<meta name="twitter:description" content="(.*?)"',
}


# The pages the server never lets a crawler index — PORTAL_PAGES in serve.js.
# Kept in step by name, because a copy of a list is a list that drifts; if one
# of these stops being a portal page it gains a head check, which is right.
NOT_INDEXED = {
    'dashboard', 'profile', 'documents', 'messages', 'applications',
    'universities', 'scholarships', 'visa', 'admin', 'counsellor', 'chat',
    'home', 'catalogue', 'blog-admin', 'leads', 'partner', 'login', '404',
}


def head_problems(src, slug=''):
    """What a search result would show, and whether anybody would click it.

    Skipped for a page that says noindex — a sign-in screen has nothing to
    rank and does not need a hundred and sixty characters about itself — and
    for the portal screens, which are behind a login.
    """
    # NOT skipped on the noindex in the file.
    #
    # Every static page ships with `noindex,nofollow` in its head — right for a
    # preview build — and serve.js flips it to index,follow on the live site,
    # per page, at serve time. So the tag on disk says nothing about whether
    # Google will read the page, and a check that trusted it would skip every
    # page on the site. That is what the first version of this did.
    if slug in NOT_INDEXED or 'p-nav' in src:
        return []                       # behind a login; nothing to rank
    # A template, not a page: its head is holes the server fills in per
    # request, and measuring "{{HEAD_TITLE}}" against what Google prints is
    # measuring the wrong thing.
    if '{{' in src:
        return []

    got, raw = {}, {}
    for name, pattern in TAG.items():
        m = re.search(pattern, src, re.S)
        if m:
            # Raw first, for the double-escape check below, then unescaped for
            # the lengths — `&amp;` is five characters in the file and one in a
            # search result, and Google counts the one.
            raw[name] = re.sub(r'\s+', ' ', m.group(1)).strip()
            got[name] = _html.unescape(raw[name])

    out = []
    if 'title' not in got:
        return ['no <title> — the tab and the search result both show the URL']
    if 'description' not in got:
        out.append('no meta description — Google writes its own, usually from a heading')

    for name, text in raw.items():
        # Escaped twice. The body of the page is right and the head reads
        # "IELTS, TOEFL &amp; PTE" in the tab and in the search result.
        if '&amp;amp;' in text or '&amp;lt;' in text or '&amp;gt;' in text:
            out.append(f'{name} is escaped twice — it reads "{text[:60]}"')

    t = got['title']
    if not TITLE_MIN <= len(t) <= TITLE_MAX:
        out.append(f'title is {len(t)} characters, outside {TITLE_MIN}-{TITLE_MAX} — "{t[:70]}"')
    d = got.get('description', '')
    if d and not DESC_MIN <= len(d) <= DESC_MAX:
        out.append(f'description is {len(d)} characters, outside {DESC_MIN}-{DESC_MAX} '
                   f'— a description outside that window is not the one shown')

    # One page, one claim. A description edited in the meta tag and not in
    # og:description is a link preview saying something the page stopped
    # saying, and nobody at Glovels ever sees the preview.
    for pair in (('title', 'og:title'), ('title', 'twitter:title'),
                 ('description', 'og:description'),
                 ('description', 'twitter:description')):
        a, b = pair
        if a in got and b in got and got[a] != got[b]:
            out.append(f'{b} does not match the {a} — "{got[b][:50]}"')

    # The company was renamed in patch 35. Fourteen hand-written pages kept the
    # old name in their title for months, where only a stranger would see it.
    for name, text in got.items():
        if 'Overseas Consultants' in text:
            out.append(f'{name} still says "Glovels Overseas Consultants", '
                       f'which is not the company\'s name')

    return out


def top_level_functions(src):
    """Names of functions declared at depth 0 of a script block.

    A brace counter, not a parser, but it knows about strings, template
    literals and comments — enough to tell a declaration inside an IIFE from
    one at the top of the file. Duplicates inside separate IIFEs are fine and
    deliberate: index.html has three render() functions, one per section.
    """
    names, depth, i, n = [], 0, 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            q, i = c, i + 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q:
                    break
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '/':
            i = src.find('\n', i)
            if i < 0:
                break
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i)
            if j < 0:
                break
            i = j + 1
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif (depth == 0 and src.startswith('function', i)
              and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] in '_$.'))):
            m = re.match(r'function\s+([A-Za-z_$][\w$]*)\s*\(', src[i:])
            if m:
                names.append(m.group(1))
        i += 1
    return names


def _node():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except Exception:
        return False


def check(path, use_node=True):
    """Every complaint about one page, as a list of strings."""
    src = path.read_text(encoding='utf-8')
    out, declared = [], []

    for n, (attrs, body) in enumerate(BLOCK.findall(src), 1):
        # Every block on a page shares one global scope, so they are counted
        # together: three copies in three <script> tags is still the last one
        # winning.
        declared += top_level_functions(body)

        for name in sorted(set(AWAITED_DECL.findall(body))):
            out.append(f'script {n}: `await … function {name}()` — a function '
                       f'declaration is being awaited, which is what a paste '
                       f'landing inside another function looks like')

        if use_node:
            suffix = '.mjs' if 'module' in attrs else '.js'
            with tempfile.NamedTemporaryFile('w', suffix=suffix, delete=False,
                                             encoding='utf-8') as fh:
                fh.write(body)
                tmp = fh.name
            r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
            pathlib.Path(tmp).unlink(missing_ok=True)
            if r.returncode:
                why = [ln for ln in r.stderr.splitlines()
                       if 'Error' in ln or 'error' in ln]
                out.append(f'script {n}: does not parse — {why[0] if why else "see node --check"}')

    for name in sorted({x for x in declared if declared.count(x) > 1}):
        out.append(f'{name}() is declared {declared.count(name)} times in the '
                   f'page scope — the last one wins and the others are dead')

    out += head_problems(src, path.stem)

    return out


def run(files=None, quiet=False):
    use_node = _node()
    pages = [pathlib.Path(f) for f in files] if files else sorted(HERE.glob('*.html'))
    bad = 0
    for p in pages:
        for line in check(p, use_node):
            print(f'  ✗ {p.name}: {line}')
            bad += 1
    if bad:
        sys.exit(f'\n{bad} problem(s) — the pages above will not behave as written.')
    if not quiet:
        note = '' if use_node else ' (node not found — parse check skipped)'
        print(f'  pages checked: {len(pages)} clean{note}')


if __name__ == '__main__':
    run(sys.argv[1:] or None)
