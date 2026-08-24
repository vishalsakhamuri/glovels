#!/usr/bin/env python3
"""
The six blog posts, written out.

The posts exist on glovels.com and the plan was to carry them across word for
word. That turned out to be the wrong plan for two reasons, one practical and
one that matters more.

The practical one: the fetching tools available here summarise a page rather
than reproduce it, so the verbatim prose could not be retrieved. What came back
was the facts — every university, fee, threshold and date — which is the part
that is hard to get right.

The one that matters: if glovels.com stays live and this site publishes the
same words, that is two domains carrying identical text. Google picks one and
suppresses the other, and which one it picks is not ours to decide. The whole
point of moving to a site we control is to be found; publishing a duplicate of
a page that already ranks is the one way to guarantee we are not.

So these are new pieces written from the same facts. Every figure below came
off glovels.com's own posts and is attributed to the cycle it belongs to.
Projections are marked as projections, because two of these posts are about
numbers that have not been announced yet and a reader who mistakes one for
policy will budget wrongly.

The body format is the one server/prose.js renders:

    ## heading        1. numbered      **bold**
    - bullet          > quote          [words](url)

Run:  python3 blog_bodies.py     (writes posts.json)
"""

import json
import pathlib

HERE = pathlib.Path(__file__).parent

POSTS = {}

# --------------------------------------------------------------------------
POSTS["expatrio-vs-fintiba-blocked-account"] = {
    "title": "Expatrio vs Fintiba: which blocked account, and what it actually costs",
    "excerpt":
        "Both are accepted by every German mission. The difference is about €50 a "
        "year, how fast your confirmation arrives, and what you are left holding "
        "when you land.",
    "metaDescription":
        "Expatrio and Fintiba compared for a German blocked account: total first-year "
        "cost, how quickly the confirmation is issued, and which one leaves you with a "
        "usable current account on arrival.",
    "body": """
Every German student visa needs proof that you can support yourself for a year,
and for almost every Indian applicant that proof is a blocked account — a
*Sperrkonto*. You pay a year of living costs into it before you apply, and it
releases the money back to you in monthly instalments once you are there.

Two providers handle the overwhelming majority of these: Expatrio and Fintiba.
Both are recognised by every German mission. Neither is a trick. The decision
comes down to three things.

## What the year costs

The money you deposit is yours and is not a cost. What you are comparing is the
provider's own fee.

- **Expatrio** — about **€227** for twelve months: roughly €119 to set it up and
  €9 a month to run it.
- **Fintiba** — about **€277.80** for twelve months: roughly €159 to set up and
  €9.90 a month.

That is a difference of around **€50.80** over the first year. Real money, and
not enough on its own to decide anything.

> Fees move. Both providers have changed them more than once, and the figures
> above are the ones published for the current cycle. Check the provider's own
> page before you pay, and tell your counsellor what you actually see.

## How fast the confirmation arrives

This is the part that decides whether you make your intake.

You cannot book a visa appointment without the blocking confirmation, and
appointment slots in India are the scarcest thing in the whole process. A
confirmation that takes four working days instead of one is four days of slots
gone to somebody else.

**Expatrio** issues the confirmation as soon as your transfer lands. **Fintiba**
does the same, but only if you funded it with an eligible credit card; a bank
transfer follows the normal clearing time.

For most of our students the transfer is the realistic route, which in practice
makes Expatrio the faster of the two.

## What you are left holding when you land

Expatrio's package includes a connected German current account, so the money
released each month has somewhere to go and you can pay rent in your first week.
Without one you land, wait for an appointment at a German bank, and live on a
card that charges you for every transaction in the meantime.

That is worth more than €50.

## The amount itself

For 2026 the requirement is **€11,904 for twelve months** — €992 a month. That is
what goes into the account, and it is separate from whatever the provider
charges.

If you are applying for the summer 2027 intake, read our post on the projected
increase before you fix a budget: the figure is expected to rise, and a file
built on last year's number is a file that gets returned.

## What we would tell you on a call

Take Expatrio unless you have a specific reason not to — cheaper, faster on a
bank transfer, and you arrive with a working account.

Take Fintiba if you are paying by eligible credit card and want the money in a
provider you already bank with, or if your university's own guidance names it.

Either way, open it earlier than feels necessary. The account is not the slow
part; the appointment after it is.
""",
}

# --------------------------------------------------------------------------
POSTS["german-universities-free-applications"] = {
    "title": "German universities you can apply to directly, with no uni-assist fee",
    "excerpt":
        "Uni-assist charges €75 for the first course and €30 for each one after it. "
        "These universities take your application themselves, on their own portal, "
        "for nothing.",
    "metaDescription":
        "German public universities that accept direct applications without uni-assist "
        "or a VPD, with the portal each one uses and what it costs.",
    "body": """
Most applications to German public universities go through uni-assist, which
checks your qualifications and charges for it: around €75 for the first course
and €30 for each additional one. Apply to eight programmes and you have spent
€285 before anybody has read a word you wrote.

A significant number of universities do not use it. They run their own portal,
assess your documents themselves, and charge nothing.

## Where you can apply directly

For **selected programmes** at each of these, the application goes straight to
the university:

- **LMU Munich** — through MoveIN
- **KIT (Karlsruhe)**
- **University of Freiburg**
- **University of Tübingen** — through ALMA
- **University of Stuttgart** — through C@MPUS
- **University of Mannheim**
- **RWTH Aachen** — through RWTHonline
- **University of Bonn**
- **University of Münster**
- **Universität Hamburg** — through STiNE
- **University of Göttingen** — free for master's; bachelor's applications carry
  a €65 evaluation fee
- **Friedrich Schiller University Jena** — through Friedolin 2.0
- **TU Darmstadt** — through TUCaN
- **University of Augsburg**
- **Saarland University** — through SIM
- **University of Bremen** — through MOIN
- **University of Hildesheim** — IT master's programmes only
- **Pforzheim University of Applied Sciences**
- **Heilbronn University of Applied Sciences**

## The word doing the work is "selected"

This is where students lose money. A university that takes direct applications
for its master's in computer science may still route its master's in economics
through uni-assist, and the department decides, not the university.

Check the programme page — not the university's admissions page, the specific
programme's own page — for the phrase that names the route. If it says
uni-assist, it means uni-assist, whatever any list on the internet says.

> A list like this one is a shortlist to check, never an answer. Portals and
> policies change between intakes, and a page that was right in July is not
> automatically right in January.

## What a VPD is, and when you still need one

A **VPD** — *Vorprüfungsdokumentation* — is uni-assist's preliminary review,
converting your marks to the German grading scale. Some universities that
otherwise accept direct applications still require a VPD, particularly in
Bavaria and Baden-Württemberg.

That is a smaller cost than a full uni-assist application, but it is not free and
it is not instant. Build three to six weeks into your timeline for it.

## One thing about tuition in Baden-Württemberg

Free applications are not the same as free study. Baden-Württemberg charges
non-EU students around **€1,500 a semester** — so KIT, Freiburg, Tübingen,
Stuttgart, Mannheim and Heilbronn are all fee-charging for you even though the
application costs nothing.

Everywhere else on this list, public university tuition for a master's is
usually a semester contribution of a few hundred euros and nothing more.

## How we use this list

We start every German shortlist with the direct-application universities,
because the same money spent on uni-assist fees is better spent on one more
application. Then we add the uni-assist ones where the programme is worth it.

If your counsellor has put eight German universities in front of you and six of
them charge, ask why.
""",
}

# --------------------------------------------------------------------------
POSTS["german-universities-lower-cgpa"] = {
    "title": "German universities that will look at a lower CGPA",
    "excerpt":
        "A German grade of 2.5 is roughly a 7.5 CGPA, and plenty of good "
        "universities publish a bar well below it. Here is where the line actually "
        "sits, university by university.",
    "metaDescription":
        "German public universities with published grade requirements below the usual "
        "bar, from Marburg at 3.2 to Passau at 2.7, and what else they weigh.",
    "body": """
The single most common thing we hear is "my CGPA is not good enough for
Germany". Usually it is, and the student has been comparing themselves against
the two or three universities everybody names.

German grades run **1.0 (best) to 4.0 (pass)** — the opposite direction to a
CGPA. Roughly: a 3.2 German grade is around a 6.0 CGPA, a 2.7 is around a 7.0,
and a 2.5 is around a 7.5. Your exact conversion is done by uni-assist or the
university, and it is not always the arithmetic you expect.

## Where the published bar sits

These are the thresholds the universities themselves publish, best first for a
lower-CGPA applicant:

- **University of Marburg** — 3.2
- **TH Köln** — 3.0
- **University of Siegen** — 3.0
- **Friedrich Schiller University Jena** — 3.0
- **Bielefeld University** — 3.0
- **University of Freiburg** — 2.9
- **University of Passau** — 2.7, or being in the top 70% (some programmes 50%)
  of your graduating cohort
- **TU Dortmund** — 2.7, and stated as no exceptions
- **University of Augsburg** — 2.7
- **University of Duisburg-Essen** — 2.7

And four with no fixed published minimum, where the decision is made on the file
as a whole:

- **BTU Cottbus-Senftenberg**
- **TU Berlin**
- **TU Darmstadt**
- **TU Clausthal**

## "No published minimum" is not "no bar"

TU Berlin is the clearest example. There is no stated grade cut-off, and fewer
than 5% of applicants get through — because the real filter is **subject
matching**. They compare your transcript module by module against their own
degree, and a strong CGPA in the wrong subjects loses to a middling one in the
right ones.

That cuts both ways. If your bachelor's genuinely lines up with the master's,
these universities are the ones most likely to look past a number.

## What else is being weighed

Nobody admits on grades alone. Where a file is borderline, these move it:

- **Relevant work experience**, especially two years or more
- **A strong language score** — a good IELTS or TOEFL, and German at A2 or above
  even for an English-taught programme
- **Publications, thesis work or a serious project** in the subject
- **A statement of purpose that explains the grade** rather than hoping nobody
  notices. A bad semester with a reason is a story; an unexplained dip is a
  question mark.

> If something went wrong in a particular year — illness, family, a change of
> college — say so plainly and briefly, once, in the SOP. Admissions committees
> read thousands of these. They are not looking for perfection.

## What we would actually do with a 6.5

Apply to Marburg, TH Köln, Siegen, Jena and Bielefeld as the realistic group.
Add Passau or Duisburg-Essen if the cohort ranking or the subject match helps
you. Put one TU on the list only if the module overlap is genuinely strong, and
treat it as the ambitious one.

That is six to eight applications, most of them free to submit, and it is a
completely reasonable file.

The mistake is not having a 6.5. The mistake is applying to three universities
that all publish 2.0 and concluding that Germany said no.
""",
}

# --------------------------------------------------------------------------
POSTS["german-universities-moi-instead-of-ielts"] = {
    "title": "German universities that may accept an MOI letter instead of IELTS",
    "excerpt":
        "A medium-of-instruction letter can save you the test and the fee — at some "
        "universities, for some programmes. The exceptions are the expensive part.",
    "metaDescription":
        "German public universities that may accept a medium-of-instruction letter "
        "instead of IELTS or TOEFL, and why the policy is set per programme rather "
        "than per university.",
    "body": """
If your bachelor's was taught in English, your college can issue a
**medium-of-instruction letter** saying so. Some German universities accept it in
place of an IELTS or TOEFL score.

When it works it saves you around ₹17,000 and six weeks. When it does not, and
you find out in November, it costs you the intake.

## Universities that may accept it

For **some** of their programmes:

- **TU Darmstadt**
- **Universität Hamburg**
- **FAU Erlangen-Nürnberg**
- **University of Technology Nuremberg (UTN)**
- **TU Dortmund**
- **TU Dresden**
- **University of Wuppertal**
- **University of Bayreuth**
- **TH Ingolstadt**
- **Kaiserslautern University of Applied Sciences**
- **University of Bremen**
- **Hochschule Bremen**
- **University of Augsburg**
- **University of Hildesheim**
- **TUM**

## Why "some programmes" is the whole story

FAU is the example worth memorising. Its **ICT** and **International Business
Studies** master's programmes accept an MOI letter. Its **Artificial
Intelligence** master's does not.

Same university. Same admissions office. Different answer.

The policy is set by the department that owns the degree, which is why a list
organised by university — including this one — can only ever tell you where to
look. The answer is on the programme's own admission requirements page.

## What makes an MOI letter acceptable

Where it is accepted, it usually has to:

- be issued by the university that awarded your degree, on letterhead, signed by
  a registrar or equivalent — not by your department or your professor
- state explicitly that **the entire programme** was taught and examined in
  English, not that English was "a medium of instruction"
- cover the full duration of the degree
- be recent, and sometimes be submitted through uni-assist with the rest of your
  documents

A letter that says "English and Hindi" is usually refused.

## Our honest advice

**Take the test anyway.**

Not because the MOI route does not work — it does, and for the right shortlist
it saves you real money. But because the score is valid two years, it is
accepted absolutely everywhere, it is required for the visa in several
destinations regardless of the university, and it removes the single most
common reason a German application is rejected on a technicality.

If Germany is your only destination and every programme on your shortlist
publishes MOI acceptance in writing, skip it. That is a narrow set of
circumstances, and it is worth confirming with your counsellor before you rely
on it.

> Never rely on a forum post, a YouTube video or a list — this one included —
> for whether a specific programme takes MOI. Find the sentence on the
> university's own page and screenshot it with the date.
""",
}

# --------------------------------------------------------------------------
POSTS["germany-blocked-account-increase-2027"] = {
    "title": "The German blocked account is likely to rise for summer 2027",
    "excerpt":
        "€992 a month is the figure today. The projections for the next three "
        "intakes are higher, and a budget built on this year's number is a budget "
        "that comes up short.",
    "metaDescription":
        "Projected German blocked account amounts for summer 2027 and beyond, why "
        "they are expected to rise, and how to plan a budget around a number that "
        "has not been announced.",
    "body": """
The blocked account requirement is tied to Germany's BAföG student support
rates. When those go up — and they are scheduled to — the amount an
international student has to show goes up with them.

## Where it stands today

**€992 a month, €11,904 for twelve months.** That is the current requirement and
it is what your file needs right now.

## What is projected

These figures follow from the announced BAföG changes. They are **not yet
official immigration policy** and they may be adjusted before they take effect:

- **Summer 2027** — around €1,052 a month, **€12,624 a year** (about €720 more)
- **Winter 2027/28** — around €1,080 a month, **€12,960 a year** (about €1,056
  more)
- **Summer 2029** — around €1,140 a month, **€13,680 a year** (about €1,776 more)

The underlying changes: the BAföG housing allowance rises from €380 to €440 a
month from summer 2027, and the basic allowance goes to €503 a month from winter
2027/28 and €563 from summer 2029.

> Treat every figure in that list as a planning number, not a rule. The
> requirement that applies to you is the one published when you apply, and it is
> the mission's figure that counts — not ours, and not a blog's.

## What this means if you are applying now

**For winter 2026/27:** nothing changes. €11,904 is the figure.

**For summer 2027 onwards:** budget for the higher number. If the increase does
not happen, or lands lower, you have overfunded a blocked account — and that
money is still yours, released to you monthly once you are in Germany. The
downside of over-preparing is nil.

The downside of under-preparing is your appointment.

## Why it matters more than the number suggests

An underfunded blocked account is not a rejection you can argue with. The
consulate checks a figure against a figure, and if yours is short the file goes
back — and by then your appointment slot has gone to somebody else and the next
one is weeks away.

The rise itself is manageable. Roughly €720 more for summer 2027 is about
₹75,000 at current rates, spread across a year of living costs you were going to
have anyway. It is a planning problem, not an affordability one — as long as it
is planned.

## What we do about it

For any student targeting summer 2027 or later, we build the shortlist and the
funding plan on the projected figure and revise down if the official number
comes in lower. We also check the education loan sanction against the projected
amount rather than the current one, because a loan approved for €11,904 in
January is a loan €720 short in May.

If you are already working with a counsellor, ask which figure your file is
built on. If the answer is €11,904 and you are applying for summer 2027, that is
worth a conversation this week.
""",
}

# --------------------------------------------------------------------------
POSTS["top-data-science-masters-germany"] = {
    "title": "Data science master's in Germany: where to apply, what it costs, when it closes",
    "excerpt":
        "Seventeen programmes, most of them tuition-free, with the deadline that "
        "actually applies to a non-EU applicant. Two of the best-known ones are not "
        "free, and one of those just changed.",
    "metaDescription":
        "Data science master's programmes at German universities with tuition, "
        "intakes and non-EU application deadlines, including the fee changes at FAU "
        "and TUM.",
    "body": """
Germany has become one of the strongest places in Europe to do a master's in
data science, and most of it is tuition-free. The catch is not cost — it is that
the deadline for a non-EU applicant is usually months earlier than the one
printed on the front of the page.

## The ones that charge

Worth knowing first, because they are the most-recommended and the assumption is
usually wrong:

- **TUM** — around **€6,000 a semester** for non-EU students
- **FAU Erlangen-Nürnberg** — around **€4,000 a semester** from summer 2027, plus
  a **€100 application fee** from winter 2026/27
- **University of Mannheim** — around **€1,500 a semester** (Baden-Württemberg's
  non-EU tuition)

## The ones that do not

Tuition-free, with only the semester contribution to pay — usually €150 to €350,
and it normally includes a public transport pass:

- **TU Braunschweig**
- **University of Göttingen**
- **Freie Universität Berlin**
- **LMU Munich**
- **University of Trier**
- **TU Dortmund**
- **University of Augsburg**
- **University of Hildesheim**
- **TU Ilmenau**
- **University of Marburg**
- **Heinrich Heine University Düsseldorf**
- **University of Oldenburg**
- **Neu-Ulm University of Applied Sciences**
- **Kiel University of Applied Sciences**

Fourteen tuition-free programmes in one subject, in one country. That is the
argument for Germany in a sentence.

## The deadlines are the hard part

Two things trip people up.

**The non-EU deadline is earlier.** Many of these close for international
applicants months before the domestic deadline — sometimes six months before
term starts. A page that says "apply by 15 July" may mean 15 January for you.

**Winter is the real intake.** Most of these programmes admit once a year, for
the winter semester starting in October. Where a summer intake exists it is
smaller and more competitive, and several of the programmes above do not have
one at all.

## What a strong application looks like

Data science admissions in Germany are unusually specific about prior modules.
Most of these programmes want to see, on your transcript:

- **Mathematics** — linear algebra, analysis, probability and statistics, often
  with a minimum number of ECTS credits stated
- **Programming** — and increasingly they want to see what you built, not just
  that you passed a course
- **A quantitative bachelor's** — computer science, mathematics, statistics,
  engineering or physics. An unrelated degree with strong maths electives can
  work; an unrelated degree without them usually does not.

The subject-match check matters more here than the grade. A 7.0 CGPA with the
right modules beats an 8.5 without them at most of these universities.

## How we would build this shortlist

Start with six to eight of the tuition-free programmes, chosen on module overlap
rather than on ranking. Add TUM if your profile is genuinely strong, understanding
the €6,000 a semester. Put FAU on only if you have read the current fee page
yourself — that one has changed recently and will change again.

Then work backwards from the earliest non-EU deadline on the list, and start the
APS certificate immediately. Not after the shortlist is agreed — immediately. It
takes six to eight weeks and it is the single item most likely to cost you the
intake.
""",
}


def main():
    out = []
    for slug, p in POSTS.items():
        out.append({
            "slug": slug,
            "title": p["title"],
            "excerpt": p["excerpt"],
            "metaDescription": p["metaDescription"],
            "body": p["body"].strip(),
        })
    (HERE / "posts.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    words = sum(len(p["body"].split()) for p in POSTS.values())
    for p in out:
        print("  %-42s %5d words" % (p["slug"], len(p["body"].split())))
    print("\n%d post(s), %s words" % (len(out), format(words, ",")))


if __name__ == "__main__":
    main()
