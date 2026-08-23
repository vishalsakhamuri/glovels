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

Run on its own:  python3 check_pages.py
Or from a build: check_pages.run() raises SystemExit on the first failure.
"""

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
