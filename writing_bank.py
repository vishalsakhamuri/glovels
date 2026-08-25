"""
The words the SOP and LOR studio writes with.

Until now the studio held four hard-coded sentences in `index.html`. It filled
two slots from the chips a student ticked and produced the same paragraph every
time — the "Write it again" button regenerated a byte-identical draft, which is
the one thing a person tests first.

This is the bank it draws from instead: several ways to open, several ways to
carry each idea, several ways to close, and per-signal sentences that say
something specific about the thing the student actually ticked. A draft is
assembled from it server-side, so the office can rewrite any of these lines from
the operations site without a developer, and so the phrasing is not sitting in
the page source for a competitor to lift.

Two rules hold everywhere in here:

  * Nothing invents a fact. No grade, no title, no publication, no employer.
    Every concrete noun in a finished draft came from a box the student typed
    into. The sentences below are scaffolding and judgement, never evidence.

  * No sentence may read as a claim the student has not made. "I was the top
    performer" is out; "the work I did there is the part of my record I would
    point to first" is in — it is a statement about emphasis, which is the
    student's to make.

The placeholders are {programme}, {university}, {signals}, {motives}, {who},
{span} and {instance}. A missing one collapses to a shorter sentence rather
than printing an empty gap; see draft() in server/writing.js.
"""

SOP_OPENINGS = [
    "I am applying to the {programme} at {university}. What brings me here is not a "
    "sudden interest but a direction that has been forming through the work I have "
    "already done.",

    "I would like to be considered for the {programme} at {university}. I have spent "
    "the last few years moving steadily towards this subject rather than arriving at "
    "it late, and this application is the next step rather than a change of mind.",

    "This is an application to the {programme} at {university}. I want to explain what "
    "led me to it, because the reasons are specific and they are the best evidence I "
    "have that I will finish what I start.",

    "I am writing to apply for the {programme} at {university}. My interest in this "
    "field has been built up in ordinary ways — coursework, projects, and work that "
    "did not always go smoothly — and that is what I would like to set out here.",

    "I am applying for a place on the {programme} at {university}. The short version "
    "is that I have found the part of this subject I want to spend my time on, and "
    "this department is where the serious version of that work happens.",
]

SOP_BACKGROUND = [
    "What shaped me most were {signals}. Those are the parts of my record I would "
    "point to first, because they are where I learned the most and where the learning "
    "stuck.",

    "The experience I would put forward is {signals}. Each of those taught me "
    "something I could not have read my way to, and together they are why I am "
    "confident about the step up this programme represents.",

    "My preparation has come from {signals}. I mention them not as a list of "
    "achievements but because they are where I found out what I am actually good at "
    "and what I still need taught.",

    "Behind this application sits {signals}. That is where my understanding of the "
    "field stopped being theoretical, and where I started to see how much I did not "
    "yet know.",
]

SOP_MOTIVE = [
    "I want to {motives}. This programme is where that becomes possible rather than "
    "aspirational.",

    "What I am setting out to do is {motives}. I have looked at how this is taught "
    "elsewhere, and the structure here is the one that matches that intention.",

    "My reason for applying is straightforward: I want to {motives}. That is a "
    "long-term intention, not a plan for the next two years only.",

    "The direction I am committing to is to {motives}. I would rather say that plainly "
    "now than discover halfway through a degree that I had not decided.",
]

SOP_FIT = [
    "I have read the structure of the {programme} carefully, and the parts that "
    "interest me most are the ones that would be hardest to teach myself. That is "
    "the honest test I applied to it.",

    "What draws me to {university} in particular is that the department treats this "
    "subject as work rather than as a syllabus, and that is the environment I do "
    "well in.",

    "I chose the {programme} at {university} after comparing several. The deciding "
    "factor was the weight it puts on the applied side, because that is where my "
    "existing experience will be worth something and where my gaps will show.",

    "I am not applying to {university} on reputation alone. The specific reason is "
    "the shape of the {programme} — what it makes compulsory tells me what the "
    "department actually values.",
]

SOP_CLOSINGS = [
    "I am ready for the pace of it, and I intend to be a student who contributes "
    "rather than only attends.",

    "I know what this course will ask of me and I have arranged my circumstances so "
    "that I can give it my full attention. I would be glad of the opportunity.",

    "I would come to this programme prepared to work, willing to be corrected, and "
    "clear about why I am there. Thank you for considering my application.",

    "If I am admitted I will treat the place as something to be justified rather than "
    "collected. Thank you for reading this.",
]

LOR_OPENINGS = [
    "I write in support of this application to the {programme} at {university}. I "
    "have known the applicant for {span} as {who}, and I am glad to be asked.",

    "I am pleased to recommend this applicant for the {programme} at {university}. "
    "I have worked with them for {span} as {who}, which is long enough to say "
    "something useful rather than something polite.",

    "This letter supports an application to the {programme} at {university}. My "
    "position is {who}, and I have observed the applicant's work over {span}.",

    "I am writing as {who} to support this application to the {programme} at "
    "{university}. {span} is long enough to have seen how the applicant works when "
    "a piece of work is going badly, which is the part worth reporting.",
]

LOR_BODY = [
    "What I saw was {signals}.",

    "The qualities I can speak to directly are {signals}. I am describing what I "
    "observed rather than what I was told.",

    "Over that period what stood out was {signals}. I would say the same in a "
    "conversation as I am saying in writing.",

    "If I had to name what distinguishes this applicant, it would be {signals}.",
]

LOR_INSTANCE = [
    "One instance stays with me: {instance}.",

    "A specific example: {instance}. I mention it because general praise is easy and "
    "particular evidence is not.",

    "The clearest example I can give is this — {instance}.",
]

LOR_CLOSINGS = [
    "I recommend the applicant without reservation, and I am happy to answer any "
    "questions.",

    "I support this application fully. Please write to me if any part of this letter "
    "would be more useful expanded.",

    "I recommend the applicant warmly, and I would be glad to be contacted if the "
    "committee wants more detail on anything above.",

    "I give this recommendation willingly and I stand behind it. I am available if "
    "the committee has questions.",
]


# ---------------------------------------------------------------- the detail
#
# The question that turns a tick into evidence.
#
# Every chip carried one fixed phrase and nothing else, so every student who
# ticked "Work experience" got the words "my time working in a real team". Two
# thousand applicants, one sentence. The draft was structurally sound and
# completely empty — which is the one thing an SOP cannot be, because the
# admissions officer reading it is looking for exactly the specifics the form
# never asked for.
#
# So each chip now asks its own question, and the answer goes into the draft in
# the student's own words. `ask` is the label, `eg` the placeholder. Both are
# UI text and are safe to send to the browser; the PHRASE stays on the server,
# because what may be claimed is the server's decision and not the page's.
ASKS = {
    # SOP
    "work": ("What was the work, and where?",
             "e.g. two years at TCS building payment reconciliation tools"),
    "project": ("What was the project?",
                "e.g. a Telugu OCR pipeline for handwritten land records"),
    "research": ("What was the research about, and what came of it?",
                 "e.g. a paper on flood prediction, presented at a college symposium"),
    "intern": ("Where was the internship, and what did you do?",
               "e.g. six months at Deloitte cleaning up client reporting data"),
    "startup": ("What did you build or take on?",
                "e.g. a Shopify store for a family business, run for 18 months"),
    "volunteer": ("Who did you teach, and what?",
                  "e.g. weekend maths to 30 students at a government school"),
    "topper": ("Where did you finish, and in what?",
               "e.g. 4th of 120 in B.Tech Computer Science, 8.7 CGPA"),
    "gap": ("What did you do with the year?",
            "e.g. worked to fund my studies and completed two online courses"),
    # LOR
    "analysis": ("What did they see you analyse?", "e.g. the load test results nobody could explain"),
    "ownership": ("What did you take on?", "e.g. ran the database migration alone over a weekend"),
    "team": ("Who with, and on what?", "e.g. a four-person team on the final-year build"),
    "comm": ("What did you explain, and to whom?",
             "e.g. presented the model to the department, twice"),
    "initiative": ("What did you do that was not asked for?",
                   "e.g. rewrote the test suite so the build stopped breaking"),
    "curious": ("What were you asking about?",
                "e.g. kept pushing on why the model failed on rural data"),
}

# The paragraph the details live in.
#
# Kept SEPARATE from the sentence that lists what the student ticked. Folding
# three long specifics into "What shaped me most were ..." produces a
# sixty-word sentence nobody finishes reading; given its own paragraph, the
# same words read as the evidence they are. If no chip has a detail the
# placeholder is empty and the paragraph collapses, exactly as {signals} and
# {instance} already do.
SOP_DETAIL = [
    "To be specific about that: {details}. I would rather set that out plainly than "
    "leave it to be guessed at from a list of titles.",

    "In concrete terms: {details}. Those are the parts I would be happy to be asked "
    "about in an interview, because I did the work myself.",

    "The detail behind that is {details}. I have kept it factual — what I did, not "
    "what it proves about me.",

    "More precisely: {details}. None of it was remarkable on its own; together it is "
    "why I am confident this is the right subject.",
]

LOR_DETAIL = [
    "Specifically: {details}. I mention these because they are what I saw first hand "
    "rather than what was reported to me.",

    "In particular: {details}. I would not put my name to this letter without being "
    "able to point to something concrete.",

    "What I am referring to is {details}. That is the basis on which I make this "
    "recommendation.",
]


def bank(ai_block):
    """Assemble the writing block from the page's own chip lists plus the bank.

    The chips (`SOP signal`, `LOR signal`, `SOP motive`) come out of index.html
    so the labels the student sees and the phrases the draft uses cannot drift
    apart. Everything else is authored here.
    """
    def chips(name, asks=False):
        out = []
        for c in ai_block.get(name, []):
            chip = {"key": c["key"], "label": c["label"],
                    "phrase": c.get("phrase") or c["label"]}
            if asks:
                ask, eg = ASKS.get(c["key"], ("What was it, exactly?", ""))
                chip["ask"] = ask
                chip["eg"] = eg
            out.append(chip)
        return out

    return {
        "sop": {
            # The signals ask their question; the motives do not. "I want to
            # move into this field properly" is already the answer to why —
            # asking a student to elaborate on their own motive produces a
            # paraphrase, not evidence.
            "signals": chips("SOP signal", asks=True),
            "motives": chips("SOP motive"),
            "openings": SOP_OPENINGS,
            "background": SOP_BACKGROUND,
            "detail": SOP_DETAIL,
            "motive": SOP_MOTIVE,
            "fit": SOP_FIT,
            "closings": SOP_CLOSINGS,
        },
        "lor": {
            "signals": chips("LOR signal", asks=True),
            "openings": LOR_OPENINGS,
            "body": LOR_BODY,
            "detail": LOR_DETAIL,
            "instance": LOR_INSTANCE,
            "closings": LOR_CLOSINGS,
        },
    }
