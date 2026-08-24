#!/usr/bin/env python3
"""
The words on the country and service pages.

Twenty-nine pages shipped with a heading, a fact box built from the database,
and a note to ourselves saying the text was still to be written. The facts were
right — they come from the catalogue — but a visitor deciding whether to spend
₹75,000 with us was reading four bullet points and a call to action.

The text already existed. It is on glovels.com, written by the office, and it
is good: it says what the reforms changed, what the funds requirement actually
is, which tests are accepted and what happens after graduation. It was simply
never carried across.

So it lives here, as data, and is rendered into the page under the fact box —
which means:

  the fact box keeps winning on anything the database knows (fees, CGPA bars,
  deadlines), because that is edited in the operations site and this is not;

  the prose is one file to edit rather than twenty-nine, and a rebuild carries
  it everywhere;

  and the FAQ is marked up as an FAQPage for Google, because the questions
  students actually type are the questions in it.

Run:  python3 page_content.py
"""

import html
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent

# The marker. Everything between this and its closing twin is rewritten on
# every run — a guard that only ever ADDS is how a page ends up with the same
# three paragraphs in it twice.
OPEN = "<!-- GLOVELS-PAGE-COPY -->"
CLOSE = "<!-- /GLOVELS-PAGE-COPY -->"


def esc(s):
    return html.escape(str(s), quote=False)


# ---------------------------------------------------------------------------
# The content itself.
#
#   lead      one sentence, replacing nothing — it goes above the sections
#   sections  {h: heading, p: [paragraphs], ul: [list items], note: callout}
#   faq       [(question, answer)]
#
# Written from the office's own pages on glovels.com. Figures are left as the
# office stated them and are dated where they move.

PAGES = {}

# --------------------------------------------------------------------- Canada
PAGES["study-in-canada"] = {
    "sections": [
        {
            "h": "Why students choose Canada",
            "p": [
                "Canada combines a high-quality education system, a multicultural "
                "environment and strong post-study work rights. Degrees are valued "
                "globally, tuition is regulated, and the co-operative education model "
                "builds paid work placements into the degree itself — so students "
                "graduate with Canadian experience as well as a Canadian qualification.",
            ],
            "ul": [
                "Top-ranking universities and colleges with rigorous academic standards",
                "Co-op programmes that integrate paid work placements into the degree",
                "An inclusive social environment and regulated, predictable tuition",
                "Strong research, innovation and entrepreneurship support",
                "Part-time work during term and full-time during scheduled breaks",
            ],
        },
        {
            "h": "What changed between 2024 and 2026 — and why it matters",
            "p": [
                "Canada reformed its student system substantially over these two "
                "years, and most of the advice online predates it. There are now "
                "annual caps on new study permits, updated financial criteria, and a "
                "provincial attestation system on top of the federal one. The Student "
                "Direct Stream was discontinued in 2024.",
                "The practical effect is that the college you choose matters more than "
                "it used to: not every institution is eligible for a post-graduation "
                "work permit, and a programme that does not lead to one is a different "
                "proposition entirely. This is the single thing we check first.",
            ],
            "note": "Start 9 to 12 months before your intake. The permit timeline, not "
                    "the admission timeline, is what decides whether you make the intake.",
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>Fall — September.</b> The main intake, with the widest choice of "
                "programmes and the most competition.",
                "<b>Winter — January.</b> Widely available and a genuine second chance "
                "rather than a fallback.",
                "<b>Spring/Summer — May.</b> Colleges and specialised programmes.",
            ],
        },
        {
            "h": "English, and French",
            "p": [
                "IELTS Academic is the most widely accepted: typically 6.0 overall for "
                "undergraduate study and 6.5 for postgraduate. TOEFL iBT, PTE Academic "
                "and the Duolingo English Test are accepted by many institutions, "
                "though not all. French-taught programmes may ask for TEF, TCF, DELF "
                "or DALF instead.",
            ],
        },
        {
            "h": "What the study permit needs",
            "ul": [
                "Letter of Acceptance from a Designated Learning Institution (DLI)",
                "Provincial or Territorial Attestation Letter (PAL)",
                "Proof of funds meeting the current IRCC guideline",
                "Valid passport",
                "Statement of purpose, or study plan",
                "Biometrics",
                "Medical examination, where required",
                "Tuition payment receipts",
            ],
        },
        {
            "h": "After you graduate",
            "p": [
                "The Post-Graduation Work Permit is an open work permit — it is not "
                "tied to one employer. The programme must run at least eight months to "
                "qualify, and master's graduates typically receive a three-year permit. "
                "You must apply within 180 days of your graduation being confirmed.",
                "Not every college is PGWP-eligible. Check before you pay a deposit, "
                "and ask us if the answer is not obvious from the institution's own "
                "website.",
            ],
        },
    ],
    "faq": [
        ("What is a Provincial Attestation Letter, and do I need one?",
         "A PAL confirms that your study permit application sits within the province's "
         "allocated quota. Most study permit applications now need one, and the "
         "institution issues it — you cannot obtain it yourself."),
        ("How many hours can I work during term?",
         "Up to 24 hours a week during academic sessions, and full-time during "
         "scheduled breaks."),
        ("Is the Student Direct Stream still available?",
         "No. SDS was discontinued in 2024. Applications go through the standard "
         "stream, which is why the funds documentation matters more than it used to."),
        ("Can my spouse work while I study?",
         "Spousal open work permits are now restricted to the spouses of master's and "
         "doctoral students and a small set of professional programmes. It is no "
         "longer automatic."),
        ("When should I start?",
         "Nine to twelve months before your intended intake. The bottleneck is the "
         "permit, not the offer."),
    ],
}

# -------------------------------------------------------------------- Germany
PAGES["study-in-germany"] = {
    "sections": [
        {
            "h": "Why Germany",
            "p": [
                "Public universities in Germany charge little or no tuition, including "
                "to international students — and they are not a budget option. German "
                "universities rank among the world's best in engineering, automotive, "
                "renewable energy, IT, robotics, biotechnology and the applied "
                "sciences, and they are taught to a standard that is famously "
                "unsentimental.",
                "Many master's programmes are taught entirely in English, so German is "
                "not a prerequisite for admission. It is, however, what decides whether "
                "you can work alongside your degree and stay afterwards — which is why "
                "we push it early rather than at the end.",
                "The industrial link is real rather than decorative. BMW, Siemens, "
                "Bosch, SAP, Mercedes-Benz and Volkswagen run internships, thesis "
                "projects and graduate hiring through the universities themselves.",
            ],
        },
        {
            "h": "What Germany asks of an Indian applicant",
            "ul": [
                "<b>A four-year Bachelor</b> — sixteen years of education. A three-year "
                "degree needs a recognised bridge or a Studienkolleg year.",
                "<b>The APS certificate</b> is mandatory for Indian applicants. Budget "
                "six to eight weeks and start it before anything else.",
                "<b>IELTS 6.5</b> overall with no band below 6.0, or TOEFL iBT 88.",
                "<b>German A1–A2</b> for daily life, even on an English-taught course.",
                "<b>A blocked account</b> holding a year of living costs, frozen before "
                "the visa interview.",
            ],
            "note": "The APS is the step people leave too late. Nothing else can start "
                    "until it is in hand, and it does not move faster because your "
                    "deadline is close.",
        },
        {
            "h": "Deadlines",
            "p": [
                "Winter intake closes 15 July; summer intake closes 15 January. Those "
                "are the university deadlines — the APS, the blocked account and the "
                "visa appointment all have to happen before them, not after.",
            ],
        },
        {
            "h": "Working, and staying",
            "p": [
                "Students may work 20 hours a week during term. After graduating you "
                "can stay to look for qualified work, and from a qualified job the "
                "route runs through the EU Blue Card to permanent residence. German "
                "language level is the main thing that decides how quickly that "
                "happens.",
            ],
        },
    ],
    "faq": [
        ("Is public university in Germany really free?",
         "Tuition at public universities is free or close to it in most federal states, "
         "including for international students. You still pay a semester contribution "
         "of roughly €150–€350, which usually includes a public transport pass, and you "
         "still have to fund your living costs — which is what the blocked account is "
         "for."),
        ("Do I need German if my course is in English?",
         "Not for admission. Yes for everything else: a part-time job, a landlord, a "
         "doctor's appointment, and the work permit afterwards. A1 before you fly and "
         "B1 within the first year is the pattern that works."),
        ("What is the APS certificate?",
         "A verification of your academic documents run by the German embassy's APS "
         "office. It is mandatory for Indian applicants and takes six to eight weeks. "
         "Every application you make will ask for it."),
        ("My CGPA is below 7.5. Is Germany closed to me?",
         "No. Public universities publish different bars, and several accept German "
         "grade equivalents of 2.7 to 3.2 — some publish no fixed minimum at all. Tell "
         "a counsellor your actual number and they will tell you which universities it "
         "opens, before you pay for anything."),
        ("How many backlogs are acceptable?",
         "Up to five is usually tolerated. More than that needs a written explanation, "
         "and it is worth writing it properly rather than hoping nobody looks."),
    ],
}

# ------------------------------------------------------------- United Kingdom
PAGES["study-in-united-kingdom"] = {
    "sections": [
        {
            "h": "Why the UK",
            "p": [
                "The UK is a leading education hub for three reasons that all point "
                "the same way: academic rigour, global recognition, and degrees that "
                "are shorter than almost anywhere else. Most bachelor's degrees run "
                "three years and many master's run one — which makes a UK education "
                "cost-effective in a way the headline tuition figure does not show.",
                "Its universities are known for research leadership and industry "
                "partnership. Students get state-of-the-art labs, professional "
                "training and skills that line up with what global employers are "
                "actually hiring for. Oxford, Cambridge, Imperial College London, UCL "
                "and the London School of Economics are here, and so are dozens of "
                "institutions below that tier which place graduates just as reliably.",
                "The multicultural environment matters more than it sounds. A UK "
                "campus puts you among students from everywhere, which is the same "
                "condition you will work in afterwards.",
            ],
            "ul": [
                "One-year master's degrees — less tuition, less living cost, a year "
                "earlier into work",
                "The Graduate Route: stay and work after you finish, no job offer "
                "needed",
                "Strong routes into technology, finance, healthcare, engineering, "
                "public policy, media and the creative industries",
                "Part-time work during term and full-time during holidays, subject to "
                "your visa conditions",
            ],
        },
        {
            "h": "Life in the UK",
            "p": [
                "You can pick a large city — London, Edinburgh, Manchester, "
                "Birmingham, Glasgow — or a student town like Oxford, Cambridge, York, "
                "Bath or Warwick, and the difference in cost is substantial. London is "
                "consistently the most expensive place to study in the country.",
                "Accommodation is university halls, private student residences or a "
                "shared flat. Public transport is developed everywhere and student "
                "discounts on it are real. Universities run academic counselling, "
                "mental health support, careers services, clubs and societies, and "
                "these are used, not decorative.",
                "Students on long-term visas pay the Immigration Health Surcharge, "
                "which buys access to the NHS for the length of the stay. Part-time "
                "work in retail, hospitality, administration, tutoring and on campus "
                "is common and helps with the monthly numbers.",
            ],
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>September — the main intake.</b> The widest course availability at "
                "every level, and the most competition.",
                "<b>January — the second major intake.</b> Popular for master's "
                "programmes, business courses and selected undergraduate degrees.",
                "<b>May — limited.</b> Certain universities only, mostly business, IT, "
                "healthcare and specific postgraduate courses.",
            ],
            "note": "Begin 8 to 12 months before your target intake, and earlier again "
                    "for the competitive universities.",
        },
        {
            "h": "English requirements",
            "p": [
                "IELTS Academic, PTE Academic and TOEFL iBT are accepted almost "
                "everywhere; the Duolingo English Test is accepted by many "
                "universities for admission. Typical bars are IELTS 6.0 to 6.5 for a "
                "bachelor's and 6.5 to 7.0 for a master's, with health sciences and "
                "competitive programmes asking for more.",
                "Some universities waive the test entirely for students who studied in "
                "English medium for a qualifying period. Whether yours does is worth "
                "checking before you book an exam.",
            ],
        },
        {
            "h": "What the Student visa needs",
            "ul": [
                "Confirmation of Acceptance for Studies (CAS) from your university",
                "Financial proof covering tuition and living expenses",
                "Evidence of English proficiency",
                "Tuberculosis test, for applicants from certain countries",
                "Valid passport",
                "Visa fee and the Immigration Health Surcharge",
            ],
        },
        {
            "h": "After you graduate",
            "p": [
                "The Graduate Route lets you stay and work with no job offer required "
                "and no restriction on sector: two years after a bachelor's or "
                "master's, three years after a PhD. It is the cleanest post-study "
                "route in Europe and it is what makes the one-year master's arithmetic "
                "work.",
            ],
        },
    ],
    "faq": [
        ("How long does a UK master's take?",
         "One year for most programmes, which is the single biggest cost advantage the "
         "UK has."),
        ("Can I work while studying?",
         "Yes — part-time during term and full-time during breaks, depending on your "
         "visa conditions."),
        ("Is the Graduate Route still available?",
         "Yes. Eligible graduates can stay two years, or three after a PhD."),
        ("Can I study in the UK without IELTS?",
         "Some universities accept alternative tests or proof of English-medium "
         "education. Not all do, so confirm before you rely on it."),
        ("What is a CAS?",
         "The Confirmation of Acceptance for Studies, issued by your university. You "
         "cannot apply for the visa without it."),
        ("What is the IHS?",
         "The Immigration Health Surcharge, paid with the visa application. It gives "
         "you NHS healthcare for the duration of your stay."),
        ("Can I bring dependants?",
         "Under current rules, mainly for postgraduate research programmes and "
         "selected master's programmes. This has tightened and is worth checking "
         "against the rules on the day you apply."),
        ("How early should I apply?",
         "Eight to twelve months before the intake."),
    ],
}

# -------------------------------------------------------------------- Ireland
PAGES["study-in-ireland"] = {
    "sections": [
        {
            "h": "Why Ireland",
            "p": [
                "Ireland is the only English-speaking country left in the EU, which "
                "is a strategic advantage rather than a slogan: an internationally "
                "recognised degree, taught in English, with access to the European "
                "job market attached to it.",
                "The job market is the other half of the argument. Google, Meta, "
                "Apple, Microsoft, Pfizer, Amazon, Intel, Deloitte and EY all run "
                "European headquarters or major operations here, in a country of five "
                "million people. That density produces internships and graduate roles "
                "at a rate the population would not suggest.",
                "Teaching emphasises critical thinking, industry-aligned curriculum "
                "and practical work — real projects, placements and research "
                "collaboration in technology, pharmaceuticals, finance, business "
                "analytics and data science.",
            ],
        },
        {
            "h": "Life in Ireland",
            "p": [
                "Dublin, Cork, Galway and Limerick are the student cities. Dublin is "
                "the most expensive by a wide margin and its accommodation market is "
                "genuinely tight — student residences, shared apartments, private "
                "rentals and homestays all fill early, and planning ahead is not "
                "optional advice here.",
                "Private medical insurance is required for the whole of your stay. "
                "Universities run on-campus health centres, counselling and student "
                "support alongside it. Part-time work is available and commonly used "
                "to manage living costs.",
            ],
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>September — the primary intake.</b> The largest, with the widest "
                "choice of programmes at every level.",
                "<b>January — secondary.</b> Selected bachelor's, master's and diploma "
                "programmes.",
                "Some private institutions offer additional start dates through the "
                "year.",
            ],
            "note": "Apply 6 to 12 months ahead. Seats are limited and visa processing "
                    "is the part that runs out of time, not admission.",
        },
        {
            "h": "English requirements",
            "ul": [
                "<b>IELTS Academic</b> — 6.0 overall with no band below 5.5 for "
                "bachelor's; 6.5 with no band below 6.0 for master's",
                "<b>PTE Academic</b> — typically 50–58 for bachelor's, 58–65+ for "
                "master's",
                "<b>TOEFL iBT</b> — equivalent scores accepted for most programmes",
                "<b>Duolingo</b> — accepted by many institutions for admission, but "
                "may not be accepted for the visa",
            ],
            "note": "Nursing, medicine and teaching ask for higher English scores than "
                    "the general bar. Students with prior English-medium education are "
                    "exempt at some universities.",
        },
        {
            "h": "What the study visa needs",
            "p": [
                "More than 90 days of study needs the Irish Study Visa — the D visa.",
            ],
            "ul": [
                "Offer letter from a recognised institution",
                "Evidence of tuition paid — at minimum the first instalment",
                "Proof of funds for living expenses and remaining tuition",
                "Medical insurance",
                "Passport, academic transcripts and English test results",
                "A statement of purpose setting out your study goals and plans",
            ],
            "note": "After you arrive you must register with Irish immigration to get "
                    "your Irish Residence Permit (IRP).",
        },
        {
            "h": "After you graduate",
            "p": [
                "The Third Level Graduate Programme lets you stay and work full-time: "
                "up to 12 months after a Level 8 bachelor's degree, up to 24 months "
                "after a Level 9 master's or higher.",
                "From there the route runs into a Critical Skills Employment Permit, a "
                "General Employment Permit, or long-term residence. It is one of the "
                "more clearly structured paths in Europe from student to settled "
                "professional.",
            ],
        },
    ],
    "faq": [
        ("How long can I stay after graduating?",
         "Two years on the Third Level Graduate Programme after a master's, one year "
         "after a bachelor's."),
        ("Is Ireland in the Schengen area?",
         "No. An Irish study visa does not give you Schengen travel, which surprises "
         "people who have planned weekend trips around it."),
        ("How many hours can I work?",
         "Up to 20 hours a week during term and up to 40 hours during holidays."),
        ("Which courses do international students take?",
         "Engineering, IT, business, data science, finance, biotechnology, nursing and "
         "hospitality are the most in demand."),
        ("Do I need health insurance?",
         "Yes. Private medical insurance is mandatory for the whole of your stay."),
        ("Can I bring dependants?",
         "Students on postgraduate programmes may, under certain conditions."),
        ("How competitive is admission?",
         "Competitive at the top universities, particularly for STEM and business. "
         "Applying early is the main thing within your control."),
    ],
}

# --------------------------------------------------------------------- Poland
PAGES["study-in-poland"] = {
    "sections": [
        {
            "h": "Why Poland",
            "p": [
                "Poland's universities sit on centuries of academic tradition — the "
                "University of Warsaw, Jagiellonian University, Warsaw University of "
                "Technology and AGH rank among Europe's stronger institutions, and the "
                "degrees are recognised across the EU.",
                "The attraction is affordability without the usual trade-off. Tuition "
                "for English-taught programmes is well below Western Europe in "
                "engineering, IT, business, medicine, economics, the arts and social "
                "sciences, and living costs are manageable rather than merely lower.",
                "It is particularly strong in STEM and the applied sciences, with real "
                "industry links: pharmaceuticals, automotive, technology, mining, "
                "robotics, AI and finance all run collaborations that put students into "
                "hands-on training, internships and research projects.",
                "Poland is in the Schengen area, so the student visa carries free "
                "travel across the zone with it.",
            ],
        },
        {
            "h": "Life in Poland",
            "p": [
                "Warsaw, Kraków, Wrocław, Gdańsk and Poznań are the student cities — "
                "good infrastructure, historic centres and living conditions built "
                "around students rather than tolerating them.",
                "University dormitories are typically the cheapest option by a "
                "significant margin, with rented apartments, student residences and "
                "shared flats above them. Transport is efficient and discounted for "
                "students on buses, trams, metro and rail. Medical insurance is "
                "required, and many universities run health services on campus.",
                "Food, transport and entertainment cost less than in most European "
                "capitals, which is what makes a modest budget go a long way here.",
            ],
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>October — the main intake.</b> Most programmes open for admission.",
                "<b>February — secondary.</b> Selected programmes, particularly "
                "master's and technical degrees.",
                "Some private universities take rolling admissions.",
            ],
            "note": "Apply 6 to 10 months ahead to secure a seat and leave room for "
                    "visa processing.",
        },
        {
            "h": "Language requirements",
            "p": [
                "For English-taught programmes: IELTS Academic around 6.0 for "
                "bachelor's and 6.5 for master's, with TOEFL iBT, PTE Academic (50–58+) "
                "and Cambridge English qualifications accepted as equivalents. Some "
                "universities waive the requirement for students from English-medium "
                "backgrounds.",
                "Polish-taught programmes need B1 to B2 Polish, evidenced by a course "
                "or an exam. Preparatory Polish programmes exist for students who mean "
                "to switch later.",
            ],
        },
        {
            "h": "What the visa needs",
            "p": [
                "Non-EU students need a National D visa, and apply for a Temporary "
                "Residence Permit after arriving.",
            ],
            "ul": [
                "Admission letter from a recognised Polish institution",
                "Proof of funds for tuition and living costs",
                "Proof of accommodation",
                "Valid medical insurance",
                "Passport and photographs",
                "Academic transcripts and certificates",
                "Statement of purpose and supporting documents",
            ],
            "note": "Processing takes several weeks and varies by country of "
                    "residence. You must also register with local authorities once you "
                    "are in Poland.",
        },
        {
            "h": "After you graduate",
            "p": [
                "Graduates can apply for a Temporary Residence Permit for job search or "
                "business activity, usually granted for 9 to 12 months. Once employed, "
                "that converts to a work permit, an EU Blue Card for highly skilled "
                "roles, or a combined temporary residence and work permit — and after "
                "the qualifying period, long-term EU residence.",
                "IT, engineering, healthcare, logistics, finance and cybersecurity are "
                "where the hiring is.",
            ],
        },
    ],
    "faq": [
        ("Are Polish degrees recognised in the EU?",
         "Yes. Poland is in the EU and the European Higher Education Area, and "
         "participates in the ECTS credit system, so degrees and credits transfer."),
        ("Do I need Polish?",
         "Not for an English-taught programme. It helps considerably for part-time work "
         "and daily life, and universities usually offer free or cheap classes."),
        ("Is Poland genuinely cheaper?",
         "Yes — both tuition and living costs are lower than most of Western Europe, "
         "and dormitory accommodation is the cheapest part of it."),
        ("Can I work while studying?",
         "Students with a valid residence permit can work part-time without needing a "
         "separate permit."),
        ("What can I stay on after graduating?",
         "A temporary residence permit for job search, typically 9 to 12 months, which "
         "converts to a work permit once you are hired."),
        ("Are there entrance exams?",
         "Some medical, engineering and art programmes require entrance tests or a "
         "portfolio."),
    ],
}

# ---------------------------------------------------------------------- Spain
PAGES["study-in-spain"] = {
    "sections": [
        {
            "h": "Why Spain",
            "p": [
                "Spain offers academic quality, cultural immersion and affordability "
                "in one place. Its universities are active in European research "
                "networks, Erasmus+ mobility and industry partnerships, and Spanish "
                "degrees are recognised across Europe and beyond.",
                "Public university tuition is moderate, living costs are manageable "
                "and transport is cheap. Programmes come taught in Spanish, in English, "
                "or bilingually — and the number of English-taught master's programmes "
                "keeps rising, particularly in business, engineering, tourism and "
                "international relations.",
                "Madrid, Barcelona, Valencia, Seville and Málaga are international hubs "
                "in their own right, which matters for what you do after the degree as "
                "much as during it. Spain is strong in business, tourism and "
                "hospitality, architecture, the arts and increasingly renewable energy.",
            ],
        },
        {
            "h": "Life in Spain",
            "p": [
                "Warm climate, coastline, historic architecture, and a social life that "
                "happens outdoors. Living costs run below most Western European "
                "capitals, and vary sharply within the country: Madrid and Barcelona "
                "are expensive, Valencia, Seville and Granada considerably less so.",
                "Accommodation is dormitories, private student residences, homestays, "
                "or — most commonly — a piso compartido, a shared flat, which is both "
                "the cheapest and the fastest way to end up with Spanish friends. "
                "Metro, tram, bus and rail networks connect the cities and the regions.",
            ],
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>September / October — the primary intake.</b> Most bachelor's and "
                "master's programmes begin in the autumn semester.",
                "<b>February — secondary.</b> Limited programmes, mostly at master's "
                "level.",
                "Private universities and business schools run rolling intakes with "
                "multiple deadlines.",
            ],
            "note": "Applications for September usually open between January and "
                    "April. Start 8 to 12 months ahead.",
        },
        {
            "h": "Language requirements",
            "ul": [
                "<b>Spanish-taught programmes</b> — B1 to B2 minimum, by DELE, SIELE or "
                "an institutional test; C1 for some advanced fields",
                "<b>English-taught programmes</b> — IELTS, TOEFL, PTE or equivalent, "
                "typically IELTS 6.0 to 6.5",
            ],
            "note": "Many universities run language preparation courses before or "
                    "alongside the degree.",
        },
        {
            "h": "What the visa needs",
            "p": [
                "Non-EU students need a long-stay student visa — the type D.",
            ],
            "ul": [
                "Acceptance letter from a recognised Spanish institution",
                "Proof of financial means for living expenses",
                "Proof of accommodation in Spain",
                "Valid passport and academic transcripts",
                "Health insurance covering the whole stay",
                "Police clearance certificate, for long-term stays",
                "Visa fee",
            ],
            "note": "Once in Spain you must apply for the Foreigners' Identity Card "
                    "(TIE) within 30 days of entry. Missing that window is the most "
                    "common avoidable problem students have here.",
        },
        {
            "h": "After you graduate",
            "p": [
                "Spain grants a job-search residence permit — the estancia por búsqueda "
                "de empleo — valid for 12 months, which lets you look for qualified work "
                "or start a business, and converts to a work permit on a suitable offer. "
                "Graduates meeting the salary and qualification thresholds can also go "
                "for the EU Blue Card, which carries mobility across other member states.",
            ],
        },
    ],
    "faq": [
        ("Do I need Spanish?",
         "Not for an English-taught master's, but Spain is a country where daily life "
         "runs in Spanish. A2 before you arrive makes the first six months a great "
         "deal easier."),
        ("Can I stay after graduating?",
         "Yes — a 12-month job-search residence permit, which converts to a work permit "
         "once you have an offer."),
        ("How many hours can I work while studying?",
         "Up to 30 hours a week, provided the work does not clash with your study "
         "schedule."),
        ("What is the TIE?",
         "The Foreigners' Identity Card, applied for within 30 days of arriving. It is "
         "what makes your residence legal for the rest of the course."),
        ("Which cities are affordable?",
         "Valencia, Seville and Granada are materially cheaper than Madrid and "
         "Barcelona for the same standard of living."),
        ("Can I travel around Europe on a Spanish student visa?",
         "Yes. Spain is in the Schengen area."),
    ],
}

# ---------------------------------------------------------------------- Italy
PAGES["study-in-italy"] = {
    "sections": [
        {
            "h": "Why Italy",
            "p": [
                "Italian public universities charge tuition on a sliding scale based "
                "on family income, which for many Indian families lands well below the "
                "headline figure. On top of that sits a substantial regional "
                "scholarship system that is genuinely worth applying for.",
                "The University of Bologna, Sapienza in Rome, Politecnico di Milano and "
                "Politecnico di Torino rank among Europe's top universities. Italy is "
                "strongest in design, fashion, architecture, engineering, fine arts, "
                "automotive design, food science, archaeology and cultural studies — "
                "fields where the country itself is the argument.",
                "Many programmes are taught entirely in English, particularly at "
                "master's level, and the number is growing.",
            ],
        },
        {
            "h": "Life in Italy",
            "p": [
                "Milan, Rome, Florence, Turin, Bologna and Naples each offer something "
                "different, and cost accordingly — Milan and Rome are notably more "
                "expensive than the smaller university towns.",
                "University cafeterias serve cheap meals, travel passes are discounted, "
                "and museums, theatres and cultural sites reduce their prices for "
                "students, which adds up to a real difference in the monthly figure. "
                "Accommodation is university residences, private student apartments, "
                "shared flats or homestays; residences are limited, so most students "
                "share.",
                "You can register with the Italian National Health Service (SSN) or hold "
                "private insurance. Either gives you access to care.",
            ],
        },
        {
            "h": "Intakes",
            "ul": [
                "<b>September / October — the primary intake.</b> Most undergraduate "
                "and postgraduate programmes.",
                "<b>February / March — secondary.</b> Selected institutions, limited "
                "programmes, second semester start.",
            ],
            "note": "Admissions for September often open in early spring, and "
                    "Universitaly pre-enrolment opens around the same time. Begin at "
                    "least 9 to 12 months ahead.",
        },
        {
            "h": "Language requirements",
            "ul": [
                "<b>Italian-taught programmes</b> — usually B2, by CILS, CELI, PLIDA or "
                "a university test",
                "<b>English-taught programmes</b> — IELTS, TOEFL, PTE or Cambridge, "
                "typically B2 for undergraduate and C1 for competitive postgraduate",
                "<b>Medicine</b> — additional entrance tests such as the IMAT",
            ],
            "note": "A2 Italian is generally the minimum for long-term residence "
                    "options later, so it is worth starting even on an English-taught "
                    "course.",
        },
        {
            "h": "Universitaly, and the visa",
            "p": [
                "Italy has a step most countries do not: Universitaly pre-enrolment, a "
                "national portal that non-EU students must complete before applying for "
                "the visa. Getting it wrong delays everything downstream, which is why "
                "we treat it as its own milestone rather than paperwork.",
                "More than 90 days of study needs the long-stay national study visa — "
                "the D visa.",
            ],
            "ul": [
                "Admission letter from an Italian university",
                "Completed Universitaly pre-enrolment",
                "Proof of financial resources",
                "Proof of accommodation",
                "Health insurance",
                "Valid passport and academic records",
                "Visa fee",
            ],
            "note": "On arrival you must apply for the permesso di soggiorno — the "
                    "residence permit — within eight working days. Eight, not thirty.",
        },
        {
            "h": "After you graduate",
            "p": [
                "Graduates can apply for a job-seeking and business start-up residence "
                "permit, valid for up to 12 months, to look for qualified work or start "
                "something. On a suitable offer it converts to a work permit, a highly "
                "skilled residence permit, or an EU Blue Card where the salary and "
                "qualification criteria are met.",
                "Some study years count toward permanent residence, though typically "
                "only partially — which is worth knowing at the start rather than "
                "discovering at the end.",
            ],
        },
    ],
    "faq": [
        ("What is the income-based tuition system?",
         "Italian public universities set fees according to a declared family income "
         "band, evidenced by an ISEE Parificato document. Getting that document right "
         "is often worth more than a scholarship."),
        ("Do I need Italian?",
         "Not for the growing number of English-taught programmes. Yes for daily life, "
         "and for most part-time work."),
        ("What is Universitaly?",
         "The national portal where non-EU students complete pre-enrolment before "
         "applying for a student visa. It is mandatory and it is not optional "
         "paperwork."),
        ("How many hours can I work?",
         "Up to 20 hours a week during the academic period."),
        ("When do I apply for the residence permit?",
         "Within eight working days of arriving in Italy. This is a short window and "
         "missing it causes real problems."),
        ("Can I stay after graduating?",
         "Yes — a 12-month job-seeker permit, convertible to a work permit once you "
         "are hired."),
    ],
}

# -------------------------------------------------------- Medical PG, Germany
PAGES["work-medical-pg-germany"] = {
    "sections": [
        {
            "h": "What this route actually is",
            "p": [
                "Postgraduate medical training in Germany is paid employment, not a "
                "tuition-based degree. You work as an Assistenzarzt in a hospital, you "
                "are paid a salary, and after four to six years you sit for your "
                "Facharzt — the German specialist qualification, which is recognised "
                "across Europe and the Gulf.",
                "More than 57,000 foreign doctors work in Germany, over 32,000 of them "
                "from outside the EU, including thousands of Indian doctors. This is a "
                "well-worn path, not an experiment.",
            ],
            "note": "There are no tuition fees for medical PG in Germany. Residents "
                    "earn roughly €2,500–€4,000 a month, with annual increments, paid "
                    "leave, insurance and pension.",
        },
        {
            "h": "Your MBBS is recognised — but you need Approbation",
            "p": [
                "An Indian MBBS is accepted in Germany, but it does not by itself let "
                "you practise. Approbation is the state licence, and getting it is the "
                "whole of the work. It runs in five steps:",
            ],
            "ul": [
                "<b>German to B2</b>, then <b>C1 Fachsprachprüfung</b> — the medical "
                "language exam. Both are required; the second is specific to clinical "
                "communication.",
                "<b>Document submission</b> to the state Approbation authority for "
                "equivalency evaluation.",
                "<b>Curriculum assessment</b> — your MBBS syllabus is compared against "
                "the German standard.",
                "<b>If gaps are found</b>, either the Kenntnisprüfung (a medical "
                "knowledge test) or an Anpassungslehrgang (a supervised adaptation "
                "period).",
                "<b>Approbation granted</b> — the full licence to practise.",
            ],
        },
        {
            "h": "What the authority will ask for",
            "ul": [
                "MBBS degree and transcript",
                "Internship completion certificate",
                "NMC registration certificate",
                "Passport",
                "German language certificates — B2 and C1 medical",
                "Police clearance certificate",
                "Medical fitness certificate",
                "Curriculum details of your MBBS",
                "Certified German translations of everything",
                "CV and motivation letter",
            ],
        },
        {
            "h": "The order it happens in",
            "ul": [
                "Free profile evaluation",
                "German language training, B2 then C1 medical",
                "Documentation prepared and translated",
                "Visa processing",
                "Arrival in Germany",
                "Approbation application submitted",
                "Fachsprachprüfung — and Kenntnisprüfung if required",
                "Approbation received",
                "Residency position applied for (Assistenzarzt)",
                "Facharzt after four to six years",
            ],
        },
        {
            "h": "What we do, and what you do",
            "p": [
                "We handle the language training to B2 and C1 medical, the certified "
                "translations, the Approbation application and its authority, the visa "
                "file, and the arrival — accommodation, city registration, and the "
                "hospital applications afterwards.",
                "You do the exams. Nobody can sit the Fachsprachprüfung for you, and no "
                "consultancy can shorten the recognition timeline. Anyone who tells you "
                "otherwise is selling something.",
            ],
        },
    ],
    "faq": [
        ("Is my Indian MBBS valid in Germany?",
         "Yes, subject to Approbation — the licence verification process. Recognition "
         "is not automatic, but Indian degrees are routinely recognised."),
        ("What German level do I need?",
         "B2 general German for the visa, and C1 Fachsprachprüfung — the medical "
         "language exam — for licensing. Both, not one or the other."),
        ("What is the Kenntnisprüfung?",
         "A medical knowledge test, required when the curriculum assessment finds gaps "
         "between your MBBS and the German standard. It is not required for everybody."),
        ("Are there tuition fees for medical PG?",
         "No. Residency training is paid employment."),
        ("How much will I earn during residency?",
         "Roughly €2,500 to €4,000 a month, rising with experience and shift "
         "allowances."),
        ("How long does the specialisation take?",
         "Four to six years, depending on the specialty."),
        ("Can I bring my family?",
         "Yes, once you meet the visa and income requirements — generally after you "
         "hold a work residence permit rather than during preparation."),
        ("Is permanent residence possible?",
         "Yes. Doctors typically move to an EU Blue Card and then to permanent "
         "residence, often within 21 to 33 months of qualified employment."),
    ],
}

# ----------------------------------------------------------- Nursing, Germany
PAGES["work-nursing-germany"] = {
    "sections": [
        {
            "h": "The shortage is the opportunity",
            "p": [
                "About 1.3 million nurses work in Germany, and more than 35,000 posts "
                "are unfilled — a figure projected to pass 200,000 by 2030. Hospitals, "
                "clinics and elderly-care homes are recruiting internationally because "
                "they have no alternative.",
                "For a qualified Indian nurse that means a stable salary, a regulated "
                "38–40 hour week with night and weekend allowances, and a route to "
                "permanent residence.",
            ],
            "note": "Starting salaries run about €2,500–€3,500 a month, rising with "
                    "experience and shift allowances. Living costs are typically "
                    "€800–€1,200 a month depending on the city.",
        },
        {
            "h": "What you need",
            "ul": [
                "<b>A nursing qualification</b> — B.Sc or M.Sc Nursing, or a GNM diploma",
                "<b>German</b> — B1 minimum, and B2 in most federal states",
                "<b>Medical fitness certificate</b>",
                "<b>Police clearance certificate</b>",
            ],
        },
        {
            "h": "Anerkennung — getting your qualification recognised",
            "p": [
                "Your Indian qualification has to be formally recognised before you can "
                "work as a registered nurse. The authority compares your training "
                "against the German standard; where gaps exist, you complete either an "
                "adaptation period (Anpassungslehrgang) or a knowledge test "
                "(Kenntnisprüfung).",
                "Recognition takes two to six months, depending on the federal state "
                "and — mostly — on whether your file was complete when it went in.",
            ],
            "ul": [
                "10th and 12th certificates, nursing degree or diploma, transcripts",
                "Internship and clinical training details",
                "German language certificate, B1 or B2",
                "Employment and experience certificates, if you have them",
                "Medical fitness and police clearance certificates",
                "CV and motivation letter",
                "Certified German translations of all of it",
            ],
        },
        {
            "h": "How we help",
            "ul": [
                "German language training to B1 and B2, including medical German",
                "Certified translations and document standardisation",
                "Choosing the right recognition authority and preparing the application",
                "Introductions to hospitals, nursing homes and care centres, and "
                "interview preparation",
                "The visa file, the embassy appointment and pre-departure briefing",
                "After arrival: accommodation, city registration, support through the "
                "adaptation period, and the PR pathway",
            ],
        },
    ],
    "faq": [
        ("Is German language mandatory?",
         "Yes. B1 as a minimum and B2 in most states, for both recognition and "
         "employment. There is no route around it."),
        ("What is the salary range?",
         "€2,500 to €3,500 a month to start, rising with experience and shift "
         "allowances."),
        ("How long does the whole process take?",
         "Typically 6 to 12 months, covering documentation, recognition and the visa."),
        ("Can I apply without work experience?",
         "Yes. Many hospitals hire fresh graduates provided the qualification is "
         "recognised."),
        ("Can I bring my family?",
         "Yes, after you hold the work permit and meet the income and accommodation "
         "requirements."),
        ("Can I stay permanently?",
         "Yes. Nurses can apply for permanent residence after the required period of "
         "work and the required German level."),
    ],
}

# ------------------------------------------------------------ Pharma, Germany
PAGES["work-pharma-germany"] = {
    "sections": [
        {
            "h": "Why Germany for pharmacists",
            "p": [
                "More than 160,000 pharmacy professionals work in Germany across some "
                "18,000 pharmacies, and enrolment has been falling while demand rises. "
                "The licensing route for foreign graduates is standardised and "
                "transparent, which is not true everywhere.",
                "The licence is called Approbation, and with it you can practise "
                "independently. Without it you cannot, whatever your degree says.",
            ],
        },
        {
            "h": "What Approbation requires",
            "ul": [
                "<b>A recognised pharmacy degree</b> — equivalent to the German "
                "Apotheker qualification",
                "<b>B2 general German</b>, and <b>C1 Fachsprachprüfung</b> — the "
                "professional language exam for pharmacists",
                "<b>Practical training</b> — a 12-month Praktisches Jahr, if your prior "
                "training is not fully equivalent",
                "<b>Police clearance and medical fitness certificates</b>",
                "<b>Certified German translations</b> of every document",
            ],
        },
        {
            "h": "The Fachsprachprüfung, in detail",
            "p": [
                "The professional language exam is three twenty-minute parts: a "
                "simulated pharmacist-to-patient conversation, pharmacy documentation, "
                "and a pharmacist-to-pharmacist or pharmacist-to-doctor exchange. It "
                "tests whether you can communicate safely in a German healthcare "
                "setting, which is a different skill from passing a C1 exam.",
            ],
        },
        {
            "h": "If your curriculum does not match",
            "p": [
                "The authority compares your degree against the German pharmacy "
                "curriculum. Fully equivalent means you proceed to licensing. Partially "
                "equivalent means either an adaptation period or a Knowledge "
                "Examination — an oral exam covering pharmacology, pharmaceutical "
                "chemistry, pharmacy law and patient counselling. Passing it grants "
                "Approbation.",
                "Professional experience can offset curriculum differences in many "
                "cases, which is worth arguing properly in the application rather than "
                "leaving to chance.",
            ],
        },
    ],
    "faq": [
        ("Is my Indian pharmacy degree recognised?",
         "It is assessed for equivalence through the Approbation process. Recognition "
         "is normal; automatic recognition is not."),
        ("What German level do I need?",
         "B2 general German and C1 Fachsprachprüfung."),
        ("How long does Approbation take?",
         "Typically 6 to 12 months, depending on the federal state and how complete "
         "your file is."),
        ("What if I fail the knowledge examination?",
         "It can be retaken. We prepare candidates for it specifically."),
        ("Can I work while my application is processed?",
         "In some cases, under supervision, depending on your visa type."),
    ],
}

# --------------------------------------------------------- Opportunity Card
PAGES["work-opportunity-card"] = {
    "sections": [
        {
            "h": "What the Opportunity Card is",
            "p": [
                "The Chancenkarte is a residence permit that lets a qualified non-EU "
                "professional enter Germany to look for work — without a job offer "
                "first. It came into force in 2024 as part of Germany's reformed "
                "skilled immigration rules.",
            ],
            "ul": [
                "Enter Germany with no prior job offer",
                "Stay for up to 12 months initially",
                "Work part-time, up to 20 hours a week, while you search",
                "Take trial jobs of up to two weeks per employer",
                "Convert to a work permit or EU Blue Card once you are hired",
            ],
        },
        {
            "h": "Two ways to qualify",
            "p": [
                "<b>Pathway 1 — recognised skilled worker.</b> A university degree, or "
                "a vocational qualification of at least two years, fully recognised as "
                "equivalent to the German qualification. No points needed.",
                "<b>Pathway 2 — the points route.</b> A qualification, plus German at "
                "A1 or English at B2, plus at least six points from: partial "
                "recognition of your qualification, a shortage occupation, work "
                "experience (two years, or five), German language level, English at C1 "
                "or above, age (under 35, or 35–40), a previous continuous six-month "
                "stay in Germany, or an eligible spouse.",
            ],
        },
        {
            "h": "Occupations in demand",
            "ul": [
                "Nursing and healthcare",
                "Engineering — mechanical, electrical, civil, automotive",
                "IT and software development",
                "Logistics, warehousing and transport",
                "Skilled trades — electricians, welders, mechatronics",
                "Green energy and renewables",
                "Robotics, automation and Industry 4.0",
            ],
        },
        {
            "h": "Money, and how long it takes",
            "p": [
                "You must show funds covering about twelve months of living costs. The "
                "official monthly benchmark is updated periodically; for 2026 it is "
                "€1,091 net a month. It can be proven by a blocked account, a formal "
                "declaration of commitment from a sponsor, bank savings, a part-time "
                "job offer, or a combination.",
                "The visa fee is around €75 for adults, and processing runs from about "
                "four weeks to three months once a complete file is submitted.",
            ],
            "note": "Your occupation does not have to be on the shortage list. You can "
                    "still reach six points through experience, age, language and "
                    "previous stays.",
        },
    ],
    "faq": [
        ("Do I need six points if I am already a recognised skilled worker?",
         "No. Pathway 1 does not use the points system, though you still have to meet "
         "the financial and basic requirements."),
        ("Is German mandatory?",
         "You need German at A1 or English at B2. German is not strictly required if "
         "your English is strong — but it is what decides whether you find qualified "
         "work once you are there."),
        ("Is there an age limit?",
         "No fixed upper limit, but the points reward youth: more points under 35, "
         "fewer between 35 and 40, none above 40."),
        ("Can my family come with me?",
         "Generally not on the Opportunity Card itself. Once you secure a job and move "
         "to a work permit or EU Blue Card, family reunification opens."),
        ("Is there an annual cap?",
         "No publicly advertised hard cap. The card exists to increase Germany's intake "
         "of qualified non-EU professionals."),
        ("Where do I apply from?",
         "The country where you legally reside — for most of our students, the German "
         "mission responsible for their region in India."),
    ],
}

# ------------------------------------------------------------ German classes
PAGES["language-german"] = {
    "sections": [
        {
            "h": "Why German, beyond the requirement",
            "p": [
                "Roughly 95 million people speak German as a first language. It is "
                "official in Germany, Austria and Liechtenstein and co-official in "
                "Switzerland, Luxembourg and Belgium — seven countries, and the largest "
                "economy in Europe.",
                "For our students it is rarely about the language itself. A1 gets you "
                "through the visa interview and the first month. B1 gets you a "
                "part-time job. B2 gets you hired after graduation, and in nursing and "
                "medicine it is the licence itself.",
            ],
        },
        {
            "h": "What each level gives you",
            "ul": [
                "<b>A1 — the foundation.</b> Greetings, family, home, travel, eating, "
                "health, work. Enough to open a bank account and register your address "
                "without help.",
                "<b>A2 — everyday competence.</b> Conjunctions, relative clauses, simple "
                "past, adjective endings. Cooking, jobs, neighbours, appointments, "
                "opinions.",
                "<b>B1 — the working level.</b> Passive voice, past perfect, future "
                "tense. Job applications, banks, housing, healthcare, conflict. This is "
                "the level at which daily life stops being an effort.",
                "<b>B2 — professional.</b> Fluent enough to work in German, argue a "
                "position and follow a fast conversation. Required for nursing "
                "recognition, and for most graduate employment.",
            ],
        },
        {
            "h": "How the classes run",
            "p": [
                "Live with a trainer, one level at a time, online or in the classroom "
                "in Hyderabad. Every level is aligned to the Goethe-Institut and telc "
                "exams, and we register you for the exam rather than leaving you to "
                "work out the process. Class work is dialogue, listening, presentation, "
                "reading, group discussion and written practice — not grammar drills at "
                "a whiteboard.",
                "Classroom students get Wi-Fi, air conditioning, books and tea. It "
                "sounds trivial until you have sat through a three-hour class without "
                "them.",
            ],
        },
    ],
    "faq": [
        ("Which exam do you prepare me for?",
         "Goethe-Institut or telc, depending on the level and what your university, "
         "employer or licensing authority accepts. We tell you which one you need "
         "before you enrol, not after."),
        ("How long does a level take?",
         "It depends on hours per week and how much you practise outside class. A1 to "
         "B1 in under a year is realistic for a student who turns up and does the work."),
        ("Do I need German for an English-taught master's?",
         "Not for admission. For a part-time job, a flat and a graduate job, yes — and "
         "starting after you arrive is starting late."),
        ("Online or classroom?",
         "Both run live with a trainer. Online suits people already working; classroom "
         "suits people who need the room to keep them honest."),
    ],
}

# ------------------------------------------------------------ French classes
PAGES["language-french"] = {
    "sections": [
        {
            "h": "Why French",
            "p": [
                "About 300 million people speak French, and it is official in 29 "
                "countries across every continent. It is a working language of the UN, "
                "UNESCO, NATO and the Red Cross.",
                "For our students there are two practical reasons: studying in France "
                "through Campus France, and Canadian immigration, where French "
                "proficiency is worth a substantial number of points under Express "
                "Entry.",
            ],
        },
        {
            "h": "The two exams, and which one you need",
            "p": [
                "<b>DELF</b> is the French Ministry of Education's certification, "
                "recognised worldwide and valid for life. Four levels — A1, A2, B1, B2 "
                "— each testing listening, reading, writing and speaking separately. "
                "This is the one for university admission.",
                "<b>TEF</b> is administered by the Paris Chamber of Commerce and is "
                "the one used for immigration, particularly to Canada. It scores you on "
                "a scale from A1 to C2 rather than passing or failing a level.",
            ],
            "note": "Choose the exam for the purpose, not the other way round. A DELF "
                    "B2 does not help a Canadian points calculation, and a TEF score "
                    "is not what a French university asks for.",
        },
        {
            "h": "The levels",
            "ul": [
                "<b>A1 — beginner.</b> Everyday expressions, introducing yourself, "
                "simple questions about where you live and who you know.",
                "<b>A2 — elementary.</b> Routine tasks, short social exchanges, "
                "describing daily life, work and surroundings.",
                "<b>B1 — moderate.</b> Handling most situations while travelling, "
                "holding a conversation on familiar topics, expressing an opinion.",
                "<b>B2 — the university level.</b> Fluent enough for regular "
                "interaction with native speakers without strain on either side, and "
                "for defending an argument.",
                "<b>C1 and C2</b> — fluent and expert. Rarely required for admission, "
                "occasionally for employment.",
            ],
        },
    ],
    "faq": [
        ("DELF or TEF?",
         "DELF for studying in France. TEF for Canadian immigration. If you need both, "
         "do TEF second — the preparation overlaps and the scoring is more forgiving."),
        ("What level does Campus France expect?",
         "B2 for a French-taught programme. English-taught programmes in France do not "
         "require it, though daily life still does."),
        ("Does French help with Canada PR?",
         "Substantially. French proficiency carries additional points under Express "
         "Entry, and there are French-specific draws with lower cut-offs."),
    ],
}


# ------------------------------------------------------------------ Canada PR
PAGES["migrate-canada-pr"] = {
    "sections": [
        {
            "h": "What permanent residence actually gives you",
            "p": [
                "Canada is one of the most transparent immigration systems in the "
                "world, and it is designed to attract skilled people rather than to "
                "keep them out. A permanent resident has almost every right a citizen "
                "has — work anywhere, free public schooling for your children, "
                "universal healthcare — and can apply for citizenship after three "
                "years of residence within a five-year window.",
                "The system is points-based and province-driven, which means it is "
                "predictable. That is the part most people miss: your score is "
                "something you can work on, not something that happens to you.",
            ],
            "ul": [
                "A stable economy with sustained demand for skilled professionals",
                "Free public education for children and universal healthcare",
                "A strong passport and the global mobility that comes with it",
                "The right to sponsor a spouse, children and parents",
                "Citizenship eligibility after 1,095 days of residence in five years",
            ],
        },
        {
            "h": "Express Entry, and the CRS",
            "p": [
                "Express Entry is the federal system that manages three categories: "
                "Federal Skilled Worker, Canadian Experience Class and Federal Skilled "
                "Trades. You create a profile, the Comprehensive Ranking System scores "
                "it, and the highest-ranked profiles receive an Invitation to Apply at "
                "each draw.",
                "A CRS above 470 is generally competitive in a general draw, but "
                "category-based draws — healthcare, STEM, trades, transport, "
                "agriculture, French — routinely go lower. Which draw you are aiming "
                "at changes what score you need, and that is a strategy decision, not "
                "an arithmetic one.",
            ],
            "ul": [
                "Check eligibility against the category you are targeting",
                "Sit a language test — IELTS or CELPIP for English, TEF or TCF for "
                "French",
                "Get an Educational Credential Assessment (ECA) for a foreign degree",
                "Create the Express Entry profile and receive a CRS score",
                "Receive an Invitation to Apply, then file the full PR application",
            ],
            "note": "Where CRS points are usually found: language retakes, spouse "
                    "points, correctly mapped work experience, French, and a "
                    "provincial nomination — which alone is worth 600 points.",
        },
        {
            "h": "The three federal categories",
            "ul": [
                "<b>Federal Skilled Worker.</b> For professionals outside Canada. At "
                "least one year of skilled work experience in TEER 0–3, CLB 7 language, "
                "an ECA for a foreign degree, proof of funds, and a minimum of 67 on "
                "the FSW grid.",
                "<b>Canadian Experience Class.</b> For people who already have one "
                "year of skilled Canadian work experience in the last three. CLB 7 for "
                "TEER 0/1 or CLB 5 for TEER 2/3, and no proof of funds if you are "
                "working in Canada. Processing tends to be faster.",
                "<b>Federal Skilled Trades.</b> A Canadian job offer or trade "
                "certification, two years of relevant experience, CLB 5 speaking and "
                "listening, CLB 4 reading and writing.",
            ],
        },
        {
            "h": "Provincial Nominee Programs",
            "p": [
                "Provinces nominate candidates against their own labour shortages, "
                "either through an Express Entry-linked stream — which adds 600 CRS "
                "points and makes an invitation effectively certain — or through a "
                "direct provincial stream outside Express Entry entirely.",
                "Ontario, Alberta, British Columbia, Saskatchewan, Manitoba, Nova "
                "Scotia and New Brunswick all run active programmes with different "
                "occupation lists. Matching your profile to the right province is "
                "usually the highest-value work in the whole file.",
            ],
        },
        {
            "h": "What you will need",
            "ul": [
                "Passport",
                "Language test results — IELTS, CELPIP, TEF or TCF",
                "Educational Credential Assessment report",
                "Educational certificates and transcripts",
                "Work experience letters, written to the format IRCC expects",
                "Proof of funds — roughly CAD 14,000 for a single applicant, more per "
                "family member, revised annually",
                "Police clearance certificates for every country you have lived in",
                "Medical examination",
                "Provincial nomination, where you have one",
            ],
        },
        {
            "h": "How long it takes",
            "p": [
                "Six to twelve months is typical from a complete profile to a decision, "
                "depending on pathway and on how complete the file was when it went in. "
                "The language test and the ECA are the front-loaded items — start them "
                "before anything else, because everything downstream waits on them.",
            ],
            "note": "There is no official age limit, but CRS points start falling after "
                    "30 and drop sharply after 40. If you are over 40, the route is "
                    "usually a provincial nomination or a job offer rather than a "
                    "general draw.",
        },
    ],
    "faq": [
        ("What CRS score do I need?",
         "Above 470 is generally competitive in a general draw. Category-based draws — "
         "healthcare, STEM, trades, French — often go considerably lower, which is why "
         "the category you target matters as much as the score itself."),
        ("Do I need a job offer?",
         "No. Express Entry is designed to work without one. A job offer can add "
         "points but is not a requirement for Federal Skilled Worker or Canadian "
         "Experience Class."),
        ("How much does French help?",
         "Strong French can add up to 50 CRS points, and there are French-language "
         "draws with markedly lower cut-offs. For many profiles it is the single "
         "largest available gain."),
        ("How much proof of funds do I need?",
         "It depends on family size and is revised every year. A single applicant needs "
         "roughly CAD 14,000; each additional family member raises it."),
        ("Can I still apply after 40?",
         "Yes, but the CRS age points are gone, so the realistic route is a provincial "
         "nomination, a job offer, or a category-based draw in your occupation."),
        ("How long does it take?",
         "Typically 6 to 12 months once a complete application is submitted. Getting "
         "to that point — language test, ECA, documents — usually takes another three "
         "to six."),
        ("When can I apply for citizenship?",
         "After 1,095 days of physical residence within the preceding five years."),
        ("Is the PR card the same as PR status?",
         "No. The card is valid five years and is a travel document; your status "
         "continues as long as you meet the residency obligation."),
    ],
}

# --------------------------------------------------------------- Australia PR
PAGES["migrate-australia-pr"] = {
    "sections": [
        {
            "h": "Why Australia",
            "p": [
                "Australia runs one of the most structured and transparent skilled "
                "migration systems anywhere. It is points-based and it publishes its "
                "rules: skills, age, English, occupation demand. High salaries, strong "
                "worker protections, Medicare, free public schooling and a clear route "
                "to citizenship are what people are actually buying.",
            ],
            "ul": [
                "Live and work anywhere in Australia on subclass 189 or 190",
                "Medicare — the public healthcare system — from the day PR is granted",
                "Free public schooling for children",
                "Include your partner and dependent children in the same application",
                "A defined pathway to citizenship",
            ],
        },
        {
            "h": "The three skilled visas",
            "ul": [
                "<b>Subclass 189 — Skilled Independent.</b> No state nomination "
                "required, points-tested, permanent from grant, and you can live "
                "anywhere in the country.",
                "<b>Subclass 190 — Skilled Nominated.</b> Requires a state or "
                "territory nomination, which adds points and materially improves your "
                "invitation odds. Permanent from grant.",
                "<b>Subclass 491 — Skilled Work Regional.</b> State or family "
                "sponsored, a five-year provisional visa, converting to permanent "
                "residence through subclass 191 once the conditions are met.",
            ],
        },
        {
            "h": "Eligibility, plainly",
            "ul": [
                "Your occupation must be on the relevant Skilled Occupation List",
                "A positive Skills Assessment from the correct assessing authority",
                "Under 45 at the time of invitation — this one is absolute",
                "Competent English or better",
                "At least 65 points, though competitive invitations sit well above that",
                "An Expression of Interest submitted through SkillSelect",
            ],
            "note": "65 points makes you eligible. It does not make you competitive. "
                    "The gap between those two things is where most of the planning "
                    "work happens.",
        },
        {
            "h": "Where the points come from",
            "ul": [
                "Age — the largest single block, and it starts falling at 33",
                "English — Proficient and Superior are worth 10 and 20 points",
                "Overseas and Australian work experience",
                "Educational qualifications",
                "The Australian study requirement",
                "A STEM qualification bonus",
                "Partner skills — worth having your partner assessed and tested",
                "State nomination — 5 points on a 190, 15 on a 491",
            ],
        },
        {
            "h": "The Skills Assessment",
            "p": [
                "This is the mandatory step and the one that most often goes wrong. It "
                "is done by the authority for your occupation, not by the department, "
                "and a negative outcome stops everything.",
            ],
            "ul": [
                "<b>ACS</b> — IT professionals",
                "<b>Engineers Australia</b> — engineers",
                "<b>VETASSESS</b> — business and general professional roles",
                "<b>AHPRA</b> — healthcare",
                "<b>TRA</b> — trades",
            ],
            "note": "Assessment usually takes six to twelve weeks. It has to be "
                    "positive before the Expression of Interest goes in, so it sets the "
                    "start date for everything else.",
        },
        {
            "h": "What you will need, and how long",
            "ul": [
                "Passport",
                "English test results — IELTS, PTE Academic, TOEFL iBT or Cambridge",
                "Skills Assessment outcome",
                "Educational certificates and transcripts",
                "Work reference letters, in the form the assessing authority requires",
                "Curriculum vitae",
                "Police clearance certificates",
                "Medical examination",
                "State nomination approval, where applicable",
            ],
            "note": "From invitation to grant is usually 8 to 18 months depending on "
                    "subclass and nomination. The whole journey, from first assessment "
                    "to visa, is realistically 18 months to two years.",
        },
    ],
    "faq": [
        ("How many points do I need?",
         "65 is the minimum to be eligible. Invitations in most occupations require "
         "considerably more, and the number moves with demand."),
        ("Is there an age limit?",
         "Yes. You must be under 45 at the time of invitation, and points begin "
         "falling from 33. Age is the one factor nothing else compensates for."),
        ("Do I need a job offer?",
         "No. The General Skilled Migration programme is designed to work without one."),
        ("Which English tests are accepted?",
         "IELTS, PTE Academic, TOEFL iBT and Cambridge English. PTE is often the "
         "faster route to a Superior score for Indian applicants."),
        ("How long does a Skills Assessment take?",
         "Six to twelve weeks, depending on the authority. Start it first — everything "
         "else waits on it."),
        ("What is SkillSelect?",
         "The system you lodge your Expression of Interest through. It ranks EOIs and "
         "issues invitations; you cannot apply for the visa without being invited."),
        ("Can my partner and children come?",
         "Yes. Partners and dependent children are included in the same application, "
         "and your partner has full work rights on grant."),
        ("Do PR holders get Medicare?",
         "Yes, from the grant of permanent residence."),
    ],
}

# ---------------------------------------------------------- IELTS, TOEFL, PTE
PAGES["test-ielts-toefl-pte"] = {
    "sections": [
        {
            "h": "Which test, and why it matters",
            "p": [
                "All three prove the same thing to a university, and they do not suit "
                "the same people. IELTS is the most widely accepted and the only one "
                "with a face-to-face speaking option. PTE is fully computer-marked, "
                "which suits candidates who find a human examiner stressful and want a "
                "result quickly. TOEFL is strongest for the United States and is "
                "accepted by more than 11,000 institutions across 150 countries.",
                "Before you book anything, check what your target universities and "
                "your destination's immigration authority accept. They are not always "
                "the same list — the Duolingo English Test, for instance, is accepted "
                "for admission by many universities and not accepted for several visa "
                "routes.",
            ],
            "note": "Scores from all three are valid for two years. Sitting the test "
                    "too early is a real and avoidable mistake.",
        },
        {
            "h": "IELTS",
            "p": [
                "Two versions: Academic, for undergraduate and postgraduate study, and "
                "General Training, for work experience, training programmes and "
                "migration. Four sections, each scored 0 to 9 in half bands, with the "
                "overall band the average of the four rounded to the nearest half. "
                "There is no pass or fail.",
            ],
            "ul": [
                "<b>Listening</b> — about 30 minutes, 40 questions across four "
                "recorded monologues and conversations",
                "<b>Reading</b> — 60 minutes, 40 questions across three long passages",
                "<b>Writing</b> — 60 minutes. Task 1 describes information in at least "
                "150 words; Task 2 is an essay of at least 250",
                "<b>Speaking</b> — 11 to 14 minutes, in three parts: interview, a long "
                "turn with a minute to prepare, and a discussion",
            ],
            "note": "About 2 hours 45 minutes in total. Listening, Reading and Writing "
                    "are one sitting; Speaking may be the same day or within a week "
                    "either side.",
        },
        {
            "h": "PTE Academic",
            "p": [
                "Computer-based and computer-marked from end to end, which is why "
                "results usually arrive within a few business days rather than weeks. "
                "Scored on the Global Scale of English, 10 to 90. Speaking is recorded "
                "against a microphone rather than spoken to a person.",
            ],
            "ul": [
                "<b>Speaking and Writing</b> — 77 to 93 minutes: read aloud, repeat "
                "sentence, describe image, re-tell lecture, short answer, summarise "
                "written text",
                "<b>Reading</b> — about 32 to 41 minutes: multiple choice, re-order "
                "paragraphs, fill in the blanks",
                "<b>Listening</b> — about 45 to 57 minutes: summarise spoken text, "
                "highlight correct summary, select missing word, highlight incorrect "
                "words, write from dictation",
            ],
            "note": "About three hours in total, in one sitting. Because the marking "
                    "is automated, technique — pacing, pronunciation, keyword density "
                    "— counts for more here than on either other test.",
        },
        {
            "h": "TOEFL iBT",
            "ul": [
                "<b>Reading</b> — 3 to 4 passages, 12 to 14 questions each",
                "<b>Listening</b> — lectures and conversations, 6 questions after each",
                "<b>Speaking</b> — four tasks, with short preparation windows of "
                "15 to 30 seconds",
                "<b>Writing</b> — two tasks",
            ],
            "note": "Scored 0 to 120 — each section out of 30. Valid two years, and "
                    "accepted by over 11,000 institutions in more than 150 countries.",
        },
        {
            "h": "How we teach it",
            "p": [
                "Small batches, online or in the classroom, with a free demo class "
                "before you commit to anything. The teaching is strategy first: what "
                "the examiner is actually marking, where the marks are lost, and how "
                "to spend the minutes you have. Then timed practice under real "
                "conditions, because a score is as much about pacing as about English.",
                "Students taking a package with us get test preparation folded into "
                "the same timeline as the applications, so the score arrives before "
                "the deadline rather than after it.",
            ],
        },
    ],
    "faq": [
        ("Which test should I take?",
         "Check what your universities and your visa route accept first. After that: "
         "IELTS for the widest acceptance, PTE for speed and a computer-marked "
         "speaking section, TOEFL for the United States."),
        ("How long are scores valid?",
         "Two years for all three. Book the test so the result is fresh when the "
         "application goes in."),
        ("How quickly do results come?",
         "PTE is usually a few business days. IELTS and TOEFL take longer — plan "
         "around a couple of weeks."),
        ("Can I retake just one section?",
         "IELTS One Skill Retake is available at many centres. TOEFL allows a section "
         "retake. PTE requires the whole test again."),
        ("What score do I need?",
         "Typically IELTS 6.0 to 6.5 for a bachelor's and 6.5 to 7.0 for a master's, "
         "with health sciences and competitive programmes asking for more. Your "
         "counsellor will tell you the exact bar for your shortlist."),
        ("Do you offer online classes?",
         "Yes — online and classroom, with a free demo class either way."),
    ],
}

# ------------------------------------------------------------- GRE, GMAT, SAT
PAGES["test-gre-gmat-sat"] = {
    "sections": [
        {
            "h": "Three different tests for three different applications",
            "p": [
                "The GRE is for graduate school generally, including many business "
                "schools. The GMAT is the business-school test specifically. The SAT "
                "is for undergraduate admission in the United States. Which one you "
                "sit follows from where you are applying, not the other way round.",
                "All three have been redesigned in the last few years and are shorter "
                "than the versions most online material still describes. Preparing "
                "from an out-of-date guide is the most common way students waste "
                "months.",
            ],
        },
        {
            "h": "GRE General Test",
            "p": [
                "Shortened in 2023 and now just under two hours. Three measures: "
                "Verbal Reasoning and Quantitative Reasoning, each scored 130 to 170 "
                "in one-point steps, and Analytical Writing scored 0 to 6 in half "
                "points. Total 260 to 340.",
            ],
            "ul": [
                "<b>Analytical Writing</b> — one Analyze an Issue task",
                "<b>Verbal Reasoning</b> — two sections: text completion, sentence "
                "equivalence and reading comprehension",
                "<b>Quantitative Reasoning</b> — two sections: quantitative comparison "
                "and problem solving",
            ],
            "note": "Section-level adaptive: how you do on the first section decides "
                    "the difficulty of the second. Scores are valid for five years.",
        },
        {
            "h": "GMAT Focus Edition",
            "p": [
                "The GMAT was replaced by the Focus Edition, which runs about two "
                "hours fifteen minutes across three 45-minute sections and is scored "
                "205 to 805. The Analytical Writing Assessment is gone; Data Insights "
                "is new and counts toward the total.",
            ],
            "ul": [
                "<b>Quantitative Reasoning</b> — problem solving, no geometry",
                "<b>Verbal Reasoning</b> — reading comprehension and critical "
                "reasoning",
                "<b>Data Insights</b> — data sufficiency, table analysis, graphics and "
                "multi-source reasoning",
            ],
            "note": "You can review and change up to three answers per section, and "
                    "you choose the section order. Both are worth practising "
                    "deliberately — they are marks, not conveniences. Scores are valid "
                    "five years.",
        },
        {
            "h": "Digital SAT",
            "p": [
                "The SAT is now digital, adaptive and about two hours fourteen "
                "minutes, down from three hours. Still scored 400 to 1600, across two "
                "sections rather than three, and the essay is gone.",
            ],
            "ul": [
                "<b>Reading and Writing</b> — two modules, 32 minutes each, short "
                "passages with one question apiece",
                "<b>Math</b> — two modules, 35 minutes each, calculator permitted "
                "throughout",
            ],
            "note": "Module-adaptive: the second module's difficulty depends on the "
                    "first. Taken on the Bluebook app at a test centre.",
        },
        {
            "h": "How we teach it",
            "p": [
                "Free demo class first. Then diagnostics to find where the marks "
                "actually are, small batches online or in the classroom, and full "
                "timed mocks in the real interface — the digital tests punish anyone "
                "who has only practised on paper.",
                "For students on a package, test preparation is scheduled against the "
                "application deadlines rather than as a separate project, so the score "
                "is in hand when the shortlist needs it.",
            ],
        },
    ],
    "faq": [
        ("GRE or GMAT for an MBA?",
         "Most business schools now accept both. Take the GRE if you are also applying "
         "to non-business master's programmes; take the GMAT Focus if business school "
         "is the whole plan and you are strong on data reasoning."),
        ("How long are scores valid?",
         "Five years for both the GRE and the GMAT."),
        ("Is the GRE really shorter now?",
         "Yes — just under two hours since 2023, with one writing task instead of two. "
         "Any guide describing a 3 hour 45 minute GRE is out of date."),
        ("What is Data Insights?",
         "The GMAT Focus section combining data sufficiency, table and graphics "
         "interpretation and multi-source reasoning. It counts toward your total score, "
         "unlike the old Integrated Reasoning."),
        ("Is the SAT still on paper?",
         "No. It is digital and adaptive, taken on the Bluebook app, about two hours "
         "fourteen minutes, with no essay."),
        ("Can I retake?",
         "Yes, all three. Most schools consider your best score, and several accept "
         "superscoring — but check each one rather than assuming."),
    ],
}

# ------------------------------------------------------------------- About us
#
# Rewritten away from the office.
#
# What was here described a consultancy in Hyderabad with an office in Munich,
# and then spent four paragraphs on how good the counselling is. Vishal's
# instruction was blunt and correct: "when we create global brand we dont have
# to mention office etc", "its like creating a online products", "we donot need
# students to visit office or counsellors have to convince students — it should
# be straight forward and easy to select the service and move forward."
#
# So this page now describes a thing you use rather than a place you go to. The
# company facts — the registered entity, the address, the jurisdiction — did not
# disappear: they moved to the Terms, where somebody looking for them expects to
# find them, and where they are a legal statement rather than a sales point.
PAGES["about-us"] = {
    "sections": [
        {
            "h": "What Glovels is",
            "p": [
                "Glovels is an online service for studying and working abroad. You "
                "answer a few questions about yourself, you see the universities you "
                "actually qualify for and what each one costs, and you pick how much "
                "help you want — from a ninety-nine rupee shortlist to a package that "
                "carries your file all the way to the visa.",
                "Everything after that happens in your account: applications, "
                "documents, payments, and every message anybody has sent you about "
                "your file. It is open at three in the morning, it is the same on a "
                "phone as on a laptop, and it does not depend on somebody being at "
                "their desk.",
            ],
        },
        {
            "h": "How it works",
            "ul": [
                "<b>Tell us about yourself</b> — marks, budget, country, intake. Six "
                "questions, no call required",
                "<b>See what you match</b> — real programmes with real fees, filtered "
                "by what you can spend and when you want to start",
                "<b>Pick a service</b> — priced on the page, from ₹99 to a full "
                "end-to-end package. You know what it costs before you speak to anyone",
                "<b>Watch it happen</b> — every application, document and decision on "
                "one screen, with the person handling it named",
            ],
        },
        {
            "h": "Why it is built this way",
            "p": [
                "The usual version of this industry runs on persuasion. You give a "
                "form your number, somebody rings, you are invited in, and the price "
                "arrives at the end of a conversation designed to make it feel small. "
                "Nobody enjoys that, and it selects for whoever is best at selling "
                "rather than whoever is best at applications.",
                "We would rather publish the prices, publish what each one includes, "
                "and let you start with ₹99 if that is what you want to risk on us. "
                "If the work is good you will come back for more of it. That is the "
                "whole strategy.",
            ],
            "note": "Public universities are the product. Where a course is free or "
                    "close to it, we say so — our fee is for getting you in, not for "
                    "steering you somewhere expensive.",
        },
        {
            "h": "What we cover",
            "ul": [
                "<b>Study abroad</b> — Germany, Canada, the UK, Ireland, Poland, "
                "Spain, Italy and more",
                "<b>Work abroad</b> — Medical PG, nursing and pharma roles in Germany, "
                "and the Germany Opportunity Card",
                "<b>Migration</b> — Canada PR and Australia PR through the skilled "
                "streams",
                "<b>Test preparation</b> — IELTS, TOEFL, PTE, GRE, GMAT and SAT",
                "<b>Language</b> — German and French, A1 to B2, with certified "
                "instructors",
                "<b>Paperwork</b> — APS certificates, attestation, notary, "
                "translation, SOP assistance and forex",
                "<b>After you land</b> — post-study work visa help, accommodation and "
                "job search support",
            ],
        },
        {
            "h": "What we will not do",
            "ul": [
                "<b>Promise an admission we cannot control.</b> Universities decide "
                "admissions and consulates decide visas. Where a package carries a "
                "guarantee, it is a promise about our fee, written down on the refund "
                "page",
                "<b>Hide a price until you are on a call.</b> Every service on this "
                "site shows what it costs",
                "<b>Push you somewhere expensive.</b> If the right answer is a free "
                "public university, or waiting a cycle and applying properly, that is "
                "the answer you get",
                "<b>Ring you eleven times.</b> You choose what you buy and when",
            ],
        },
        {
            "h": "The numbers",
            "ul": [
                "More than 2,000 institutions on the catalogue",
                "Around 160,000 programmes searchable by budget, intake and entry bar",
                "Eight countries covered end to end",
            ],
        },
    ],
    "faq": [
        ("Do I have to come to an office?",
         "No. The whole thing runs online — shortlist, applications, documents, "
         "payments and messages all live in your account. Who we are as a company, "
         "and where we are registered, is set out in the Terms and Conditions."),
        ("Do I have to talk to somebody before I can buy anything?",
         "No. Prices are on the page and you can start at ₹99 without speaking to "
         "anyone. A counsellor is assigned when you buy something that needs one."),
        ("What does ₹99 actually get me?",
         "Three universities matched to your profile, with fees, intake and deadline "
         "for each, delivered to your account. It is meant to be small enough to try."),
        ("Do you only work with expensive universities?",
         "The opposite. Public universities with low or no tuition are the core of what "
         "we do, and we will tell you when a course costs nothing."),
        ("Can I see my application progress?",
         "Yes. Every student gets an account showing applications, documents, payments "
         "and the full conversation with their counsellor."),
        ("Who will I actually be dealing with?",
         "One named counsellor on the packages that include counselling, who stays "
         "with your file to the end."),
    ],
}

# -------------------------------------------------------------------- Careers
PAGES["careers"] = {
    "sections": [
        {
            "h": "Join the team",
            "p": [
                "Glovels Overseas Consultants Private Limited helps people study, work "
                "and settle abroad. It is work where the outcome is visible: somebody "
                "gets on a plane, or does not. The people who do well here care about "
                "that difference.",
            ],
            "ul": [
                "<b>Work that lands somewhere.</b> You are part of how a family's plan "
                "actually happens.",
                "<b>Training and progression.</b> We invest in people continuously "
                "rather than at review time.",
                "<b>A team, not a floor.</b> Small, collaborative, and everybody's "
                "opinion is available to everybody else.",
                "<b>International exposure.</b> Universities, embassies and partners "
                "across eight countries.",
            ],
        },
        {
            "h": "Current openings",
            "p": [
                "<b>Education Counsellor</b> — Hyderabad. Counselling students on "
                "study abroad options, taking them through university applications and "
                "visa filing, and running information sessions and workshops. A "
                "bachelor's degree, strong communication, and experience in education "
                "consulting preferred.",
                "<b>Visa Consultant</b> — Hyderabad. Guiding clients through visa "
                "applications for multiple countries, staying current on changing "
                "regulations, and coordinating with embassies and consulates. A "
                "bachelor's degree in any field, strong organisation and "
                "problem-solving; prior visa or immigration experience is a plus.",
                "<b>Language Trainer, German or French</b> — Hyderabad. Teaching "
                "students preparing to study or work abroad, building lesson plans and "
                "materials, and tracking progress. Native or near-native proficiency, "
                "a teaching certification, and cultural sensitivity.",
            ],
        },
        {
            "h": "How to apply",
            "p": [
                "Send your CV and a covering note to <a href=\"mailto:careers@glovels.com\">"
                "careers@glovels.com</a>, with the role in the subject line. We read "
                "everything that arrives and reply either way.",
            ],
            "note": "Glovels Overseas Consultants Private Limited is an equal "
                    "opportunity employer. We are committed to an inclusive workplace "
                    "and we hire on what people can do.",
        },
    ],
    "faq": [
        ("How do I apply?",
         "Email careers@glovels.com with your CV and the role in the subject line."),
        ("Are the roles in the office or remote?",
         "The current openings are all based in our Hyderabad office in Madhapur."),
        ("Do I need study abroad experience?",
         "It helps and it is preferred for the counsellor role, but it is not a bar. "
         "We train."),
        ("Do you take interns?",
         "We run internships from time to time. Write to careers@glovels.com and say "
         "what you are looking for."),
    ],
}

# ------------------------------------------------------------------ Contact us
#
# The old version of this page opened with a landmark, a metro exit and a bus
# stop, and its FAQ answered "can I visit without an appointment?". That is a
# page for a shopfront. "Donot stress more on office, visits etc" — so the
# addresses stay, because a company that hides where it is registered looks
# like one worth hiding from, but they are facts at the bottom rather than the
# invitation at the top.
PAGES["contact-us"] = {
    "sections": [
        {
            "h": "The fastest way to reach us",
            "p": [
                "If you already have an account, sign in and message your counsellor "
                "there. It goes onto your file, the whole team can see it, and you "
                "have a record of what was said.",
                "If you do not, the chat on this site reaches the same people, and "
                "anything you write there is waiting for you when you sign up.",
            ],
            "ul": [
                "WhatsApp or phone: <a href=\"tel:+917839399999\">+91 78393 99999</a>",
                "Email: <a href=\"mailto:info@glovels.com\">info@glovels.com</a>",
                "Germany: <a href=\"tel:+498920194090\">+49 89 2019 4090</a>",
            ],
        },
        {
            "h": "What to expect when you write",
            "ul": [
                "A reply within one working day, from a person rather than a queue",
                "A straight answer about price and scope — both are on the site "
                "already, so there is nothing to extract from us",
                "No obligation, and nobody ringing you for a fortnight afterwards",
            ],
            "note": "You do not have to speak to anybody to start. Services are "
                    "priced on the site from ₹99, and a counsellor is assigned when "
                    "you buy something that needs one.",
        },
        {
            "h": "Who you are dealing with",
            "p": [
                "Glovels Overseas Consultants Private Limited, registered in India, "
                "with people in Hyderabad and in Germany. The full company details — "
                "registered entity, address, GSTIN and jurisdiction — are set out in "
                "the <a href=\"terms.html\">Terms and Conditions</a>.",
            ],
        },
        {
            "h": "For admissions and partnerships",
            "ul": [
                "General enquiries — <a href=\"mailto:info@glovels.com\">info@glovels.com</a>",
                "Careers — <a href=\"mailto:careers@glovels.com\">careers@glovels.com</a>",
            ],
        },
    ],
    "faq": [
        ("Do I need to book a call before I can do anything?",
         "No. You can answer the profile questions, see your matches and buy a "
         "service without speaking to anybody."),
        ("How quickly do you reply?",
         "Within one working day to email, and usually the same day to a message in "
         "the portal or on WhatsApp."),
        ("Is the first consultation free?",
         "Yes. A profile evaluation costs nothing, whether or not you ever buy "
         "anything."),
        ("Do you work with students outside India?",
         "Yes. Nothing about the service depends on where you are — it runs in your "
         "account, in whatever timezone you are in."),
    ],
}

# --------------------------------------------------------------------- Refer
PAGES["refer"] = {
    "sections": [
        {
            "h": "Refer somebody, get paid",
            "p": [
                "If you know somebody planning to study, work or travel abroad, send "
                "them to us. When they buy a service, you get cashback. There is no "
                "cap on how many people you can refer.",
            ],
            "ul": [
                "<b>Register</b> — sign up and get your own referral link",
                "<b>Share it</b> — with friends, classmates, colleagues or family",
                "<b>They buy</b> — your referral signs up through your link and "
                "completes a purchase",
                "<b>You get paid</b> — once the purchase is verified, the cashback is "
                "credited automatically. Nothing to chase",
            ],
        },
        {
            "h": "What you earn",
            "ul": [
                "Service value ₹15,000 – ₹29,999 — <b>₹2,000</b>",
                "Service value ₹30,000 – ₹49,999 — <b>₹2,500</b>",
                "Service value ₹50,000 and above — <b>ask us</b>; we agree the amount "
                "before your referral pays, in writing",
            ],
            "note": "Only confirmed and paid purchases qualify. If a service is "
                    "refunded or cancelled, the reward is reversed with it.",
        },
        {
            "h": "What counts",
            "ul": [
                "<b>Visas</b> — tourist and visit, business, student, work, dependent, "
                "job seeker",
                "<b>Test preparation</b> — IELTS, TOEFL, PTE, GRE, GMAT and German",
                "<b>Migration</b> — Canada PR, Australia PR, UK skilled migration, "
                "German work pathways",
                "<b>Specialist routes</b> — digital nomad visas, investor and "
                "entrepreneur applications",
            ],
        },
        {
            "h": "The rules, in full",
            "ul": [
                "Your referral must sign up through your link before they pay — a "
                "referral claimed afterwards cannot be verified and will not be paid",
                "You cannot refer yourself, or somebody in your own household paying "
                "for you",
                "One reward per referred person, on their first paid service",
                "Rewards are paid within 30 days of the purchase being verified",
                "Cancelled or refunded purchases reverse the reward",
                "We may vary or end the programme, but never for a referral already "
                "registered and paid",
            ],
        },
    ],
    "faq": [
        ("When do I get paid?",
         "Within 30 days of your referral's purchase being verified."),
        ("How many people can I refer?",
         "As many as you like. There is no cap on referrals or on total earnings."),
        ("Can I refer myself?",
         "No. Self-referrals and referrals within the same household do not qualify."),
        ("What if my referral cancels?",
         "The reward is reversed, because it is paid on a completed purchase."),
        ("What about services over ₹50,000?",
         "Ask us before your referral pays. We agree the amount in writing rather than "
         "leaving it to a table that stops at ₹49,999."),
    ],
}

# ------------------------------------------------------------------- Glossary
PAGES["glossary"] = {
    "sections": [
        {
            "h": "Applications and admission",
            "ul": [
                "<b>APS</b> — Akademische Prüfstelle. The German certificate verifying "
                "that your Indian degree is genuine. Mandatory for German university "
                "applications and one of the longest lead items in the whole file.",
                "<b>CAS</b> — Confirmation of Acceptance for Studies. The reference "
                "number a UK university issues once you accept an offer. You cannot "
                "apply for the visa without one.",
                "<b>Conditional offer</b> — an offer that becomes real once you meet a "
                "stated condition, usually a final transcript or a language score.",
                "<b>ECTS</b> — the European credit system. 60 credits is one academic "
                "year, and it is what makes credits transfer between EU countries.",
                "<b>Intake</b> — the month a course starts. Most countries run a large "
                "autumn intake and a smaller winter one.",
                "<b>LOR</b> — letter of recommendation, from a professor or an "
                "employer.",
                "<b>SOP</b> — statement of purpose. The essay explaining why this "
                "course, why this country, and why you.",
                "<b>Uni-Assist</b> — the shared application service many German "
                "universities use to check foreign qualifications.",
                "<b>Universitaly</b> — the Italian national portal where non-EU "
                "students complete pre-enrolment before applying for a visa.",
                "<b>VPD</b> — Vorprüfungsdokumentation. Uni-Assist's preliminary "
                "review document, converting your grades to the German scale.",
            ],
        },
        {
            "h": "Tests and language",
            "ul": [
                "<b>CEFR</b> — the European framework for language levels, A1 to C2. "
                "A1 is a beginner; B2 is what most universities and employers mean by "
                "'you can work in this language'.",
                "<b>CLB</b> — Canadian Language Benchmarks. Canada converts your IELTS "
                "or CELPIP result into a CLB level, and immigration rules are written "
                "in CLB, not band scores.",
                "<b>Duolingo English Test</b> — accepted for admission by many "
                "universities, not accepted for several visa routes. Check both.",
                "<b>IELTS / TOEFL / PTE</b> — the three main English tests. Scores are "
                "valid two years.",
                "<b>GRE / GMAT / SAT</b> — graduate, business school and US "
                "undergraduate admission tests. GRE and GMAT scores are valid five "
                "years.",
                "<b>TestDaF / DSH / telc</b> — German-language tests for admission to "
                "German-taught programmes.",
                "<b>DELF / TEF</b> — French certifications. DELF for university, TEF "
                "for immigration.",
            ],
        },
        {
            "h": "Money",
            "ul": [
                "<b>Blocked account</b> — a German bank account holding a year's "
                "living costs, released to you monthly. Proof of funds for the visa.",
                "<b>Proof of funds</b> — evidence that you can pay tuition and live "
                "for the first year. Every country has its own figure and its own "
                "rules about whose money counts.",
                "<b>Semester contribution</b> — the administrative fee German public "
                "universities charge instead of tuition. It usually includes a public "
                "transport pass.",
                "<b>Sponsor</b> — the person funding your study, usually a parent. "
                "Their documents get scrutinised as closely as yours.",
                "<b>Tuition</b> — what the course costs. At many European public "
                "universities this is zero or close to it, which is the entire reason "
                "we push them.",
            ],
        },
        {
            "h": "Visas and after",
            "ul": [
                "<b>Biometrics</b> — fingerprints and a photograph, taken at a visa "
                "centre as part of the application.",
                "<b>CRS</b> — Comprehensive Ranking System. The score Canada ranks "
                "Express Entry candidates by.",
                "<b>ECA</b> — Educational Credential Assessment. Canada's check that "
                "your foreign degree is equivalent to a Canadian one.",
                "<b>EOI</b> — Expression of Interest. The profile you lodge before "
                "being invited to apply, used by Australia and by several Canadian "
                "provinces.",
                "<b>EU Blue Card</b> — a work and residence permit for highly "
                "qualified non-EU professionals, with mobility across member states.",
                "<b>PGWP</b> — Post-Graduation Work Permit. Canada's post-study work "
                "route, and not every institution qualifies for it.",
                "<b>PNP</b> — Provincial Nominee Program. A Canadian province "
                "nominating you, worth 600 CRS points.",
                "<b>Permesso di soggiorno</b> — the Italian residence permit, applied "
                "for within eight working days of arrival.",
                "<b>Skills Assessment</b> — Australia's mandatory check that your "
                "qualifications and experience match your nominated occupation.",
                "<b>TIE</b> — Spain's Foreigners' Identity Card, applied for within 30 "
                "days of arriving.",
            ],
        },
    ],
    "faq": [
        ("Why does an APS take so long?",
         "It is a document verification with a queue, not a form. Start it the moment "
         "Germany is on your shortlist — it is the item most likely to cost you an "
         "intake."),
        ("What is the difference between a conditional and an unconditional offer?",
         "A conditional offer still depends on something — a final transcript, a "
         "language score. An unconditional offer is yours outright and is what most "
         "visa applications need."),
        ("Is a Duolingo score enough?",
         "For admission at many universities, yes. For several visa routes, no. Check "
         "the visa rule before you book, not after."),
    ],
}

# ---------------------------------------------------------------- Disclaimers
PAGES["disclaimers"] = {
    "sections": [
        {
            "h": "What this page is",
            "p": [
                "This page sets out the limits of what the information on this website "
                "is, and what it is not. It sits alongside our Terms of Service, "
                "Privacy Policy and Refund Policy rather than replacing any of them.",
            ],
        },
        {
            "h": "Information, not advice",
            "p": [
                "Everything on this site — country pages, fee estimates, entry "
                "requirements, intake dates, university listings and blog posts — is "
                "general information published in good faith. It is not legal, "
                "immigration, financial or academic advice, and it is not a substitute "
                "for advice about your own circumstances.",
                "Decisions about your application should be taken with your counsellor "
                "and checked against the primary source: the university's own website, "
                "and the relevant embassy, consulate or immigration authority.",
            ],
        },
        {
            "h": "Rules change, and they change without notice",
            "p": [
                "Immigration rules, tuition fees, financial requirements, language "
                "thresholds and processing times are set by governments and "
                "universities, not by us. They change, sometimes mid-cycle and "
                "sometimes retroactively. We update these pages as we learn of "
                "changes, but there will be periods when a page is behind the "
                "authority it describes.",
            ],
            "note": "Where a figure on this site differs from the figure published by "
                    "an embassy, a government department or a university, theirs is "
                    "correct and ours is out of date. Tell us and we will fix it.",
        },
        {
            "h": "No guarantee of admission or of a visa",
            "p": [
                "We cannot guarantee admission to any institution, the grant of any "
                "visa or permit, a particular scholarship, a particular processing "
                "time, or any employment outcome. Those decisions belong to "
                "universities, immigration authorities and employers, and they are "
                "made on their criteria.",
                "What we can commit to is the work described in your package: the "
                "shortlist, the applications, the documentation and the filing, done "
                "properly and on time. Anybody in this industry promising you a visa "
                "is either misinformed or lying to you.",
            ],
        },
        {
            "h": "Third-party content and links",
            "p": [
                "This site links to universities, government departments, test "
                "providers and other organisations. We do not control those sites and "
                "are not responsible for their content, their accuracy or their "
                "privacy practices. A link is not an endorsement.",
                "University names, logos and trade marks belong to their owners and "
                "appear here to identify the institution. They do not imply "
                "affiliation, partnership or endorsement unless we say so explicitly.",
            ],
        },
        {
            "h": "Fees, estimates and currency",
            "p": [
                "Tuition, living costs and third-party charges shown on this site are "
                "estimates, usually stated in the currency of the destination and "
                "converted for convenience. Exchange rates move, and third parties — "
                "universities, embassies, testing bodies, banks — set their own fees "
                "and change them when they choose.",
                "Our own service fees are what appears on your invoice at the time you "
                "pay, and the scope covered by them is in the package terms you accept "
                "at checkout.",
            ],
        },
        {
            "h": "Reviews, testimonials and results",
            "p": [
                "Student stories and outcomes shown on this site are individual "
                "experiences published with consent. They describe what happened for "
                "that person and are not a prediction of what will happen for you.",
            ],
        },
    ],
    "faq": [
        ("If a fee on this site is wrong, what applies?",
         "The university's or authority's published figure. Ours is an estimate and "
         "may be behind theirs."),
        ("Can you guarantee my visa?",
         "No, and neither can anybody else. Visa decisions are made by governments on "
         "their own criteria. We can commit to the quality and timing of the work in "
         "your package."),
        ("Does listing a university mean you are affiliated with it?",
         "No. Names and logos identify the institution and imply no partnership unless "
         "we state one explicitly."),
    ],
}

# ---------------------------------------------------------------- rendering

def render(slug, page):
    """One page's copy, as HTML, ready to drop into the prose column."""
    out = [OPEN]

    for sec in page.get("sections", []):
        out.append("<h2>" + esc(sec["h"]) + "</h2>")
        for para in sec.get("p", []):
            out.append("<p>" + para + "</p>")
        if sec.get("ul"):
            out.append("<ul>" + "".join("<li>" + li + "</li>" for li in sec["ul"]) + "</ul>")
        if sec.get("note"):
            out.append('<div class="pagenote">' + sec["note"] + "</div>")

    faq = page.get("faq") or []
    if faq:
        out.append("<h2>Questions we are actually asked</h2>")
        out.append('<div class="pfaq">')
        for q, a in faq:
            out.append("<details><summary>" + esc(q) + "</summary><p>" + a + "</p></details>")
        out.append("</div>")

    out.append(CLOSE)
    return "\n  ".join(out)


def jsonld(page):
    """The FAQ, for Google.

    Marked up because these are the questions students type into a search box
    almost word for word, and an FAQPage block is the difference between being
    the answer and being the ninth link that might contain it.
    """
    faq = page.get("faq") or []
    if not faq:
        return ""
    import json
    doc = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [{
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)},
        } for q, a in faq],
    }
    return ('<script type="application/ld+json">'
            + json.dumps(doc, ensure_ascii=False).replace("<", "\\u003c")
            + "</script>")


CSS = """<style>/* GLOVELS-PAGE-COPY-CSS */
.prose h2{margin-top:34px}
.prose .pagenote{background:#fdf6e6;border:1px solid #e6d5a8;border-radius:12px;
  padding:14px 17px;margin:16px 0 0;font:600 13.6px/1.7 var(--sans);color:#5b4409}
.pfaq{display:grid;gap:9px;margin-top:14px}
.pfaq details{border:1px solid var(--line);border-radius:12px;background:var(--paper)}
.pfaq summary{cursor:pointer;list-style:none;padding:14px 17px;
  font:700 14.2px/1.5 var(--sans);color:var(--navy-900);display:flex;gap:12px;
  align-items:flex-start;justify-content:space-between}
.pfaq summary::-webkit-details-marker{display:none}
.pfaq summary::after{content:"+";font:400 20px/1 var(--sans);color:var(--muted);flex:none}
.pfaq details[open] summary::after{content:"\\2013"}
.pfaq details[open] summary{border-bottom:1px solid var(--line)}
.pfaq details p{margin:0;padding:14px 17px;font-size:13.9px;line-height:1.72;
  color:var(--navy-800)}
</style>
"""


def apply_to(slug, page):
    f = HERE / (slug + ".html")
    if not f.exists():
        return "missing"
    t = f.read_text(encoding="utf-8")
    if '<div class="wrap prose">' not in t:
        return "no prose column"

    body = render(slug, page)

    # Replaced, not appended. This block is rewritten on every run, so editing
    # the text here is the only way it changes — and running twice cannot
    # produce two copies of it.
    if OPEN in t and CLOSE in t:
        t = t[:t.index(OPEN)] + body + t[t.index(CLOSE) + len(CLOSE):]
    else:
        # Above the closing call-to-action link, which reads as the end of the
        # page and should stay there.
        anchor = '<p style="margin-top:26px">'
        if anchor in t:
            i = t.index(anchor)
            t = t[:i] + body + "\n  " + t[i:]
        else:
            i = t.index('<div class="wrap prose">') + len('<div class="wrap prose">')
            t = t[:i] + "\n  " + body + t[i:]

    # The note to ourselves saying the page was still to be written. It was
    # true when it was put there. Leaving it under two thousand words of copy
    # is worse than never having written the copy — it tells a visitor the page
    # they just read is a placeholder.
    t = re.sub(r'\s*<div class="towrite">(?:(?!</div>)[\s\S])*</div>', "", t, count=1)

    # The stylesheet and the FAQ record, once each.
    if "GLOVELS-PAGE-COPY-CSS" not in t:
        t = t.replace("</head>", CSS + "</head>", 1)
    # Every FAQPage record already on the page, removed before a new one goes
    # in. The first version of this matched `{"@context":"https://schema.org"`
    # with no spaces, and json.dumps writes `{"@context": "https://schema.org"`
    # WITH them — so it matched nothing, removed nothing, and every run left
    # another copy behind. Four builds, four identical records on one page.
    # Tolerant of whitespace now, and there is a test for the count.
    t = re.sub(r'<script type="application/ld\+json">\s*\{\s*"@context"\s*:\s*'
               r'"https://schema\.org"\s*,\s*"@type"\s*:\s*"FAQPage".*?</script>\n?',
               "", t, flags=re.S)
    ld = jsonld(page)
    if ld:
        t = t.replace("</head>", ld + "\n</head>", 1)

    f.write_text(t, encoding="utf-8")
    return "written"


def main():
    done, skipped = [], []
    for slug, page in PAGES.items():
        state = apply_to(slug, page)
        (done if state == "written" else skipped).append(f"{slug}: {state}")
    for d in done:
        print("  " + d)
    for s in skipped:
        print("  SKIPPED " + s)
    words = sum(len(re.sub(r"<[^>]+>", " ", p).split())
                for page in PAGES.values()
                for sec in page.get("sections", [])
                for p in sec.get("p", []) + sec.get("ul", []) + [sec.get("note") or ""])
    words += sum(len((q + " " + a).split())
                 for page in PAGES.values() for q, a in (page.get("faq") or []))
    print(f"\n{len(done)} page(s) written, {words:,} words")
    if skipped:
        sys.exit(1)


if __name__ == "__main__":
    main()
