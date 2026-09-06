"""Writing a post and putting it on the site, without a developer."""

BODY = """
    <style>
      .out.tiles{grid-template-columns:repeat(var(--tiles,4),1fr)}
      @media (max-width:820px){ .out.tiles{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:430px){ .out.tiles{grid-template-columns:1fr} }

      .blog-cols{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start}
      @media (max-width:1000px){ .blog-cols{grid-template-columns:1fr} }

      .plist{list-style:none;margin:0;padding:0;max-height:72vh;overflow-y:auto}
      .plist li{padding:12px 15px;border-bottom:1px solid var(--line);cursor:pointer;
        display:flex;flex-direction:column;gap:4px}
      .plist li:hover{background:#f7f9fc}
      .plist li.on{background:#f0f5fb;box-shadow:inset 3px 0 0 var(--navy-700)}
      .plist b{font:700 13px/1.42 var(--sans);color:var(--navy-900)}
      .plist span{font-size:11.6px;color:var(--muted)}

      .ed .field{margin-bottom:14px}
      .ed label{display:block;font:700 12.4px/1.4 var(--sans);color:var(--navy-800);
        margin-bottom:5px}
      .ed label small{font-weight:600;color:var(--muted);letter-spacing:0}
      .ed input,.ed textarea,.ed select{width:100%;padding:10px 12px;border:1.5px solid #d8dde4;
        border-radius:10px;font:400 13.6px/1.6 var(--sans);background:#fff;color:var(--navy-900)}
      .ed textarea{resize:vertical}
      .ed textarea#pBody{min-height:46vh;font:400 14px/1.75 ui-monospace,SFMono-Regular,
        Menlo,monospace}
      .ed .two{display:grid;grid-template-columns:1fr 1fr;gap:13px}
      @media (max-width:640px){ .ed .two{grid-template-columns:1fr} }

      /* What Google prints. A description is a sentence written to a length,
         and a writer who cannot see the length writes the wrong one. */
      .serp{border:1px solid var(--line);border-radius:12px;padding:15px 17px;
        background:#fff;margin:0 0 16px}
      .serp .u{font-size:12.4px;color:#1a6b3c;word-break:break-all}
      .serp .t{font:400 18px/1.35 var(--sans);color:#1a0dab;margin:3px 0 3px}
      .serp .d{font-size:13px;line-height:1.58;color:#4d5156}
      .cnt{float:right;font:600 11.4px/1.4 var(--sans);color:var(--muted)}
      .cnt.over{color:#b03a2e}
      .cnt.good{color:#14603a}

      .helpbox{background:#f7f9fc;border:1px solid var(--line);border-radius:11px;
        padding:13px 15px;font-size:12.3px;line-height:1.65;color:var(--navy-800)}
      .helpbox code{background:#eef2f7;padding:1px 5px;border-radius:5px;
        font:600 11.8px/1.4 ui-monospace,monospace}
      .stpill{display:inline-block;padding:2px 9px;border-radius:999px;
        font:700 10.6px/1.7 var(--sans);letter-spacing:.06em;text-transform:uppercase}
      .stpill.live{background:#e6f4ec;color:#14603a}
      .stpill.draft{background:#fdf6e6;color:#8a5a0b}

      /* Read next. Tick boxes rather than a multi-select, because a writer
         has to see the headlines to choose between them. */
      .relpick{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
        gap:9px;margin:0 0 20px;max-height:230px;overflow-y:auto;padding:2px}
      .relbox{display:flex;gap:9px;align-items:flex-start;padding:10px 12px;
        border:1.5px solid #d8dde4;border-radius:11px;background:#fff;cursor:pointer}
      .relbox:hover{border-color:var(--navy-600,#1c4d78)}
      .relbox input{width:auto;flex:none;margin:2px 0 0}
      .relbox b{display:block;font:700 12.6px/1.42 var(--sans);color:var(--navy-900)}
      .relbox small{display:block;font:400 11.4px/1.5 var(--sans);color:var(--muted);
        margin-top:2px}
      .relbox:has(input:checked){border-color:var(--navy-700,#13385c);background:#f0f5fb}

      .pictools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px}
      .pictools .hint{font:400 11.6px/1.5 var(--sans);color:var(--muted)}
      .ed textarea#pBody.dropping{outline:2px dashed var(--navy-700,#13385c);outline-offset:2px}
      .coverrow{display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:start}
      .coverrow img{width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;
        border:1px solid var(--line);background:#f2f5f9;display:block}
      .coverrow .nopic{width:120px;aspect-ratio:16/9;border-radius:8px;border:1px dashed
        var(--line);display:grid;place-items:center;font:600 11px/1.3 var(--sans);
        color:var(--muted);text-align:center}
      @media (max-width:560px){ .coverrow{grid-template-columns:1fr} }
      .picgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;
        max-height:280px;overflow-y:auto;padding:2px}
      .picgrid button{padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;
        cursor:pointer;overflow:hidden;text-align:left}
      .picgrid button:hover{border-color:var(--navy-700,#13385c)}
      .picgrid img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
      .picgrid small{display:block;padding:4px 6px;font:400 10.6px/1.3 var(--sans);
        color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

      .wixbox{margin:0 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;
        background:var(--paper,#fff)}
      .wixbox h3{margin:0 0 6px;font:700 14px/1.3 var(--sans);color:var(--navy-900)}
      .wixbox p{margin:0 0 10px;font:400 12.6px/1.6 var(--sans);color:var(--muted)}
      .wixbox .bar{height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin:10px 0}
      .wixbox .bar i{display:block;height:100%;background:var(--navy-700,#13385c);width:0;
        transition:width .4s}
      .wixbox .items{max-height:200px;overflow-y:auto;font:400 12px/1.6 ui-monospace,SFMono-Regular,
        Menlo,monospace;color:var(--navy-800);border-top:1px solid var(--line);padding-top:8px}
      .wixbox .items .failed{color:#7a2118}
    </style>

    <div class="out tiles" style="--tiles:4;margin:0 0 18px">
      <div><b id="kLive">—</b><span>On the site</span></div>
      <div><b id="kDraft">—</b><span>Not on the site</span></div>
      <div><b id="kEmpty">—</b><span>Written but empty</span></div>
      <div><b id="kWords">—</b><span>Words published</span></div>
    </div>

    <div class="wixbox" id="wixBox" hidden>
      <h3>The posts on glovels.com</h3>
      <p>Every post on the old site is read, its pictures are copied onto this server,
        and each one arrives here as a <b>draft</b> at the same address. Nothing goes on
        the site until you open it and press Publish. A post that already exists here is
        left alone.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary btn-sm" id="wixGo">Bring them across</button>
        <label style="font:400 12.4px/1.5 var(--sans);color:var(--navy-800);display:flex;
          gap:6px;align-items:center"><input type="checkbox" id="wixOver"> Replace drafts
          that were brought across before</label>
        <button type="button" class="btn btn-ghost btn-sm" id="wixHide">Close</button>
      </div>
      <div class="bar" id="wixBar" hidden><i></i></div>
      <p id="wixSaid" style="margin:8px 0 0"></p>
      <div class="items" id="wixItems" hidden></div>
    </div>

    <div class="blog-cols">
      <div class="p-card" style="padding:0">
        <div style="padding:12px 15px;border-bottom:1px solid var(--line);display:flex;
          gap:10px;align-items:center">
          <b style="font:700 12.4px/1 var(--sans);letter-spacing:.07em;
            text-transform:uppercase;color:var(--muted)">Posts</b>
          <button type="button" class="btn btn-ghost btn-sm" id="wixBtn"
            style="margin-left:auto" title="Copy every post on glovels.com into this blog, as drafts">From glovels.com</button>
          <button type="button" class="btn btn-primary btn-sm" id="newPost">+ New</button>
        </div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--line);display:flex;gap:8px;
          flex-wrap:wrap;min-width:0">
          <input id="pq" placeholder="Find a post" aria-label="Find a post" style="flex:1 1 140px;min-width:0;
            width:auto;padding:8px 11px;font:400 13px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px">
          <select id="pst" aria-label="Which posts" style="flex:0 1 auto;min-width:0;max-width:100%;padding:8px 9px;
            font:600 12.4px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;background:#fff">
            <option value="">All</option>
            <option value="published">On the site</option>
            <option value="draft">Not on the site</option>
          </select>
        </div>
        <ul class="plist" id="postList"></ul>
        <div id="postPager" style="padding:0 10px"></div>
      </div>

      <div class="p-card ed" id="editor">
        <p style="margin:0;font-size:13px;color:var(--muted);line-height:1.7">
          Pick a post on the left, or start a new one.<br><br>
          What you write here is the page. There is no second step and nothing to deploy —
          Publish puts it on glovels.com, and Save keeps it out of sight until you are ready.</p>
      </div>
    </div>
"""

SCRIPT = r"""
/* POSTS is the page the database sent, not the whole blog — at ten thousand
   posts the list is searched and paged there, a hundred at a time. */
let POSTS = [], POST_TOTAL = 0, STATS = {}, openId = null, dirty = false;

const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' });
};

/* A stored ISO timestamp as the yyyy-mm-dd an <input type="date"> takes.
   Anything else — including an empty string and a date we cannot read — comes
   back empty, because a date box handed "Invalid Date" silently shows nothing
   and then SAVES nothing, which looks like the field losing the writer's
   answer. */
const dateOnly = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
};

/* The published posts this one can point at, as tick boxes. Itself is never
   offered: a post that reads next to itself is a loop with a byline. */
const relBox = (x, on) =>
  '<label class="relbox"><input type="checkbox" value="' + esc(x.slug) + '"'
  + (on ? ' checked' : '') + '>'
  + '<span><b>' + esc(x.title) + '</b>'
  + '<small>' + esc(x.tag || 'No topic') + ' &middot; ' + fmtWhen(x.publishedAt)
  + '</small></span></label>';

function relBoxes(p) {
  /* The ones already chosen are drawn at once (so Save cannot lose them);
     the rest come from a search of the published posts — a list of ten
     thousand tick boxes is not a way to pick three. */
  return '<input id="relQ" placeholder="Find a published post to add" aria-label="Find a published post"'
    + ' style="width:100%;margin:0 0 9px;padding:8px 11px;font:400 13px/1.4 var(--sans);'
    + 'border:1.5px solid #d8dde4;border-radius:9px">'
    + '<div id="relChosen"></div><div id="relFound"></div>';
}

let relReq = 0;
async function loadRel(p) {
  const chosen = String(p.related || '').split(/[,\s]+/).filter(Boolean);
  const q = ($('#relQ') ? $('#relQ').value : '').trim();
  const mine = ++relReq;
  const r = await api('GET', '/api/staff/posts?status=published&per=30'
    + (q ? '&q=' + encodeURIComponent(q) : ''));
  if (mine !== relReq || !$('#relFound')) return;
  const ticked = new Set([...$('#relPick').querySelectorAll('input:checked')].map(b => b.value));
  chosen.forEach(sl => ticked.add(sl));
  /* Draw the chosen ones once, from what the search knows plus the slug. */
  if (!$('#relChosen').children.length && chosen.length) {
    const known = new Map(r.posts.map(x => [x.slug, x]));
    $('#relChosen').innerHTML = chosen.filter(sl => sl !== p.slug).map(sl =>
      relBox(known.get(sl) || { slug: sl, title: sl, tag: '', publishedAt: '' }, true)).join('');
  }
  const shown = new Set([...$('#relChosen').querySelectorAll('input')].map(b => b.value));
  const others = r.posts.filter(x => x.slug !== p.slug && !shown.has(x.slug));
  $('#relFound').innerHTML = others.map(x => relBox(x, ticked.has(x.slug))).join('')
    || (r.total ? '' : '<p style="margin:0;font-size:12.4px;color:var(--muted)">Nothing else is '
      + 'on the site yet. Publish a second post and they can point at each other.</p>');
}

/* Kept in step with the server's slugify. A writer who sees one address here
   and another one on the live post has been lied to by the screen. */
const slugify = s => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 80) || 'post';

/* Three states, not two.
 *
 * "The tile reads 5 DRAFTS — the admin believes five posts are unpublished
 *  while all five are live."
 *
 * They were. The blog index deliberately keeps the six pages that were on
 * glovels.com before this screen existed, serving from their original files
 * until a written post replaces each one — dropping them the day the database
 * took over would have taken six live pages off the site. That is right. What
 * was wrong is that this screen did not know it: a post with no body and a
 * status of draft was counted as unpublished and labelled Draft, while anybody
 * could read it at its address.
 *
 * So: on the site because it was published here, on the site because its
 * original page is still there, and not on the site at all. The middle one is
 * the one nobody knew about. */
const isLive = p => p.status === 'published' || p.onDisk;

function paintList() {
  /* Counted by the database over the whole blog, not over the page. */
  $('#kLive').textContent = STATS.live == null ? '—' : STATS.live;
  $('#kDraft').textContent = STATS.draft == null ? '—' : STATS.draft;
  $('#kEmpty').textContent = STATS.empty == null ? '—' : STATS.empty;
  $('#kWords').textContent = (STATS.words || 0).toLocaleString('en-IN');
  $('#postPager').innerHTML = pagerHtml('post', POST_TOTAL, 'posts', () => { load().catch(e => toast(e.message)); });

  $('#postList').innerHTML = POSTS.map(p =>
    '<li data-post="' + p.id + '"' + (p.id === openId ? ' class="on"' : '') + '>'
    + '<b>' + esc(p.title) + '</b>'
    + '<span><span class="stpill ' + (p.status === 'published' ? 'live">On the site'
        : p.onDisk ? 'live">On the site — original page'
        : 'draft">Not on the site') + '</span> '
      + (p.words ? p.words.toLocaleString('en-IN') + ' words' : 'no words yet')
      + ' &middot; ' + fmtWhen(p.updatedAt) + '</span></li>').join('')
    || '<li style="cursor:default;color:var(--muted);font-size:12.6px">'
       + 'Nothing here yet. Press New.</li>';
}

/* ---------------------------------------------------------------- the form */

function editor(p) {
  const isNew = !p.id;
  $('#editor').innerHTML =
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;'
        + 'padding-bottom:13px;border-bottom:1px solid var(--line);margin-bottom:16px">'
      + '<b style="font:700 15px/1.3 var(--disp,inherit);color:var(--navy-900)">'
        + (isNew ? 'New post' : esc(p.title)) + '</b>'
      + '<span class="stpill ' + (p.status === 'published' ? 'live">On the site'
          : p.onDisk ? 'live">On the site — original page'
          : 'draft">Not on the site') + '</span>'
      + '<span style="flex:1"></span>'
      + (isNew ? '' : '<a class="btn btn-ghost btn-sm" id="pView" target="_blank" '
        + 'href="/post/' + esc(p.slug) + '">View the page</a>')
      + (p.onDisk ? '<p style="flex-basis:100%;margin:8px 0 0;padding:10px 12px;'
        + 'border-radius:10px;background:#f2f6fd;border:1px solid #cddcf3;'
        + 'font:400 12.4px/1.6 var(--sans);color:var(--navy-800)">'
        + '<b>This one is already readable.</b> The page that was on glovels.com '
        + 'before this screen existed is still being served at that address. '
        + 'Publishing what you write here replaces it; until then, visitors see '
        + 'the old page.</p>' : '')
      + (isNew ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="pDrop">'
        + (p.status === 'published' ? 'Take off the site' : 'Delete') + '</button>')
      + '</div>'

    + '<div class="field"><label for="pTitle">Headline</label>'
      + '<input id="pTitle" value="' + esc(p.title || '') + '" '
      + 'placeholder="What a student would type into Google"></div>'

    + '<div class="two">'
      + '<div class="field"><label for="pSlug">Address <small>glovels.com/post/…</small></label>'
        + '<input id="pSlug" value="' + esc(p.slug || '') + '"></div>'
      + '<div class="field"><label for="pTag">Topic <small>optional</small></label>'
        + '<input id="pTag" value="' + esc(p.tag || '') + '" '
        + 'placeholder="Germany, Visa, Money…"></div>'
    + '</div>'

    + '<div class="two">'
      + '<div class="field"><label for="pAuthor">Written by'
        + '<small> — shown on the post and given to Google</small></label>'
        + '<input id="pAuthor" value="' + esc(p.author || '') + '" '
        + 'placeholder="The counsellor who wrote it"></div>'
      + '<div class="field"><label for="pPublished">Published on'
        + '<small> — leave it and we use the day you press Publish</small></label>'
        + '<input id="pPublished" type="date" value="' + esc(dateOnly(p.publishedAt)) + '">'
        + '<small style="display:block;margin-top:5px;font:400 11.6px/1.55 var(--sans);'
        + 'color:var(--muted)">Last updated ' + (p.updatedAt ? esc(fmtWhen(p.updatedAt))
          : 'never') + '. That date goes on the post and into the page, so a guide '
        + 'you corrected today does not read as a year old.</small></div>'
    + '</div>'

    + '<div class="field"><label for="pExcerpt">The line under the headline'
      + '<small> — shown on the blog list and at the top of the post</small>'
      + '<span class="cnt" id="cExcerpt">0 / 500</span></label>'
      + '<textarea id="pExcerpt" rows="3" maxlength="500" placeholder="Leave it empty and we use your '
      + 'first two sentences.">' + esc(p.excerpt || '') + '</textarea></div>'

    + '<div class="field"><label for="pCover">Cover picture'
      + '<small> — shown under the headline and on the blog list. Optional.</small></label>'
      + '<div class="coverrow"><div id="coverPrev">' + coverThumb(p.cover) + '</div>'
      + '<div><input id="pCover" value="' + esc(p.cover || '') + '" '
        + 'placeholder="/images/… — or upload one">'
      + '<div class="pictools" style="margin-top:8px">'
        + '<button type="button" class="btn btn-ghost btn-sm" id="coverUp">Upload a picture</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="coverPick">Choose one already up</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="coverClear">Remove</button>'
      + '</div></div></div></div>'

    + '<div class="field"><label for="pBody">The post'
      + '<span class="cnt" id="cWords">0 words</span></label>'
      + '<div class="pictools">'
        + '<button type="button" class="btn btn-ghost btn-sm" id="picAdd">Add a picture</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="picPick">Pictures already up</button>'
        + '<span class="hint">Or paste one, or drop a file onto the text. It goes in where the cursor is.</span>'
      + '</div>'
      + '<textarea id="pBody" placeholder="Write it the way you would type it.">'
      + esc(p.body || '') + '</textarea>'
      + '<div id="picGrid" hidden style="margin-top:8px"></div></div>'
    + '<input type="file" id="picFile" accept="image/jpeg,image/png,image/gif,image/webp" hidden>'

    + '<div class="helpbox" style="margin-bottom:20px">'
      + '<b>What the box understands.</b> '
      + '<code>## Heading</code> makes a heading &middot; '
      + '<code>- item</code> on its own line makes a list, and indenting the next '
        + 'one nests it underneath &middot; '
      + '<code>[words](https://…)</code> makes a link &middot; '
      + '<code>**bold**</code>. A blank line starts a new paragraph.'
      + '<br><br><b>A picture:</b> press <b>Add a picture</b> above the box, or paste one in. '
      + 'It arrives as <code>![what it shows](/images/photo.jpg)</code> — replace the words '
      + 'in the square brackets with what the picture shows: they are read out to a blind '
      + 'reader, printed if the picture fails to load, and read by Google. Add '
      + '<code>"a caption"</code> after the address to print one underneath.'
      + '<br><br><b>A table:</b> one row per line with <code>|</code> between the '
      + 'columns, and <code>|---|---|</code> under the first row.'
    + '</div>'

    + '<h3 style="font:700 14.6px/1.3 var(--sans);color:var(--navy-900);margin:0 0 4px">'
      + 'Read next</h3>'
    + '<p style="margin:0 0 11px;font-size:12.3px;color:var(--muted);line-height:1.6">'
      + 'The posts to send the reader to at the foot of this one. You pick them, '
      + 'because you know which one answers their next question. Only published '
      + 'posts are listed, and one that comes off the site quietly stops appearing '
      + 'here rather than becoming a dead link.</p>'
    + '<div class="relpick" id="relPick">' + relBoxes(p) + '</div>'

    + '<h3 style="font:700 14.6px/1.3 var(--sans);color:var(--navy-900);margin:0 0 4px">'
      + 'How it looks in Google and on WhatsApp</h3>'
    + '<p style="margin:0 0 13px;font-size:12.3px;color:var(--muted);line-height:1.6">'
      + 'This is the whole of what somebody sees before they decide whether to click. '
      + 'Leave a box empty and we use the headline and your first two sentences — which '
      + 'is better than nothing and worse than writing it.</p>'

    + '<div class="serp"><div class="u" id="sU">glovels.com/post/…</div>'
      + '<div class="t" id="sT">—</div><div class="d" id="sD">—</div></div>'

    + '<div class="field"><label for="pMetaTitle">Title for search'
      + '<small> — leave empty to use the headline</small>'
      + '<span class="cnt" id="cTitle">0 / 60</span></label>'
      + '<input id="pMetaTitle" value="' + esc(p.metaTitle || '') + '"></div>'

    + '<div class="field"><label for="pMetaDesc">The sentence under it'
      + '<span class="cnt" id="cDesc">0 / 155</span></label>'
      + '<textarea id="pMetaDesc" rows="2">' + esc(p.metaDesc || '') + '</textarea></div>'

    + '<div class="two">'
      + '<div class="field"><label for="pKeywords">Keywords <small>comma separated</small></label>'
        + '<input id="pKeywords" value="' + esc(p.keywords || '') + '" '
        + 'placeholder="study in germany, blocked account, public university"></div>'
      + '<div class="field"><label for="pOg">Picture for the link preview '
        + '<small>optional — 1200 × 630</small></label>'
        + '<input id="pOg" value="' + esc(p.ogImage || '') + '" '
        + 'placeholder="https://www.glovels.com/og/blocked-account.jpg">'
        + '<small style="display:block;margin-top:5px;font:400 11.6px/1.55 var(--sans);'
        + 'color:var(--muted)">Leave it empty and we use the first picture in the '
        + 'post, or the Glovels one. A link pasted into WhatsApp is never blank.</small>'
        + '</div>'
    + '</div>'

    + '<p id="pErr" role="alert" style="display:none;margin:0 0 12px;padding:11px 13px;'
      + 'border-radius:10px;font:600 12.9px/1.55 var(--sans);background:#fdf3f2;'
      + 'border:1px solid #f0c8c4;color:#7a2118"></p>'

    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;'
      + 'padding-top:14px;border-top:1px solid var(--line)">'
      + '<button type="button" class="btn btn-ghost" id="pSave">Save</button>'
      + '<button type="button" class="btn btn-primary" id="pPub">'
        + (p.status === 'published' ? 'Save and keep it live' : 'Publish to the site')
        + '</button>'
      + '<span id="pSaid" style="font:600 12.6px/1.5 var(--sans);color:#14603a"></span>'
    + '</div>';

  ['pTitle', 'pSlug', 'pExcerpt', 'pBody', 'pMetaTitle', 'pMetaDesc'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener('input', () => { dirty = true; preview(); });
  });
  /* The address follows the headline until somebody types their own. An
     address that quietly stops matching the headline is how a post ends up at
     /post/untitled-2. */
  $('#pTitle').addEventListener('input', () => {
    if (!$('#pSlug').dataset.touched && (!p.id || !p.slug)) {
      $('#pSlug').value = slugify($('#pTitle').value);
      preview();
    }
  });
  $('#pSlug').addEventListener('input', () => { $('#pSlug').dataset.touched = '1'; });

  /* Ticking a related post is an edit like any other. Without this the tick
     survives until the next Save and is then thrown away with the rest of an
     un-flagged form — the change that is hardest to notice is the one that
     looked like it worked. */
  $('#relPick').addEventListener('change', () => { dirty = true; });
  let relTimer = null;
  $('#relQ').addEventListener('input', () => {
    clearTimeout(relTimer);
    relTimer = setTimeout(() => { loadRel(p).catch(() => {}); }, 220);
  });
  loadRel(p).catch(() => {});
  $('#pAuthor').addEventListener('input', () => { dirty = true; });
  $('#pPublished').addEventListener('change', () => { dirty = true; });

  $('#pSave').onclick = () => save('draft', p);
  $('#pPub').onclick = () => save('published', p);
  if ($('#pDrop')) $('#pDrop').onclick = () => drop(p);
  pictures();
  preview();
}

/* ------------------------------------------------------------- pictures */

function coverThumb(url) {
  return url ? '<img src="' + esc(url) + '" alt="">'
    : '<div class="nopic">No cover<br>picture</div>';
}

/** Send one file up; resolve to its address on this site. */
async function uploadPicture(file) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'picture');
  /* fetch directly: this screen's api() speaks JSON only, and a FormData put
     through JSON.stringify arrives as the two characters {}. */
  const r = await fetch('/api/staff/images', { method: 'POST', credentials: 'same-origin', body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d.image;
}

/* Put text into the body where the cursor is, and keep the cursor after it. */
function insertAtCursor(text) {
  const ta = $('#pBody');
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  /* On its own line, with a blank line each side, so it renders as a figure
     rather than inline in the middle of a sentence. */
  const before = v.slice(0, a), after = v.slice(b);
  const lead = before && !/\n\n$/.test(before) ? (/\n$/.test(before) ? '\n' : '\n\n') : '';
  const tail = after && !/^\n\n/.test(after) ? (/^\n/.test(after) ? '\n' : '\n\n') : '';
  ta.value = before + lead + text + tail + after;
  const at = (before + lead + text).length;
  ta.setSelectionRange(at, at);
  ta.focus();
  dirty = true;
  preview();
}

function pictureLine(image, alt) {
  return '![' + (alt || 'What the picture shows') + '](' + image.url + ')';
}

const say = (msg, bad) => {
  const err = $('#pErr');
  if (!err) return;
  err.textContent = msg;
  err.style.display = msg ? 'block' : 'none';
  err.style.background = bad ? '#fdf3f2' : '#eaf6ee';
  err.style.borderColor = bad ? '#f0c8c4' : '#bfe0cc';
  err.style.color = bad ? '#7a2118' : '#14603a';
};

/* The grid of pictures already on the server, to reuse one. `onPick` gets the
   image; the grid closes itself. */
async function showGrid(onPick) {
  const g = $('#picGrid');
  if (!g.hidden) { g.hidden = true; return; }
  g.hidden = false;
  g.innerHTML = '<p class="hint" style="margin:0">Loading…</p>';
  try {
    const r = await api('GET', '/api/staff/images');
    if (!r.images.length) {
      g.innerHTML = '<p class="hint" style="margin:0">Nothing has been uploaded yet. '
        + 'Add a picture and it will be here next time.</p>';
      return;
    }
    g.innerHTML = '<div class="picgrid">' + r.images.map((im, i) =>
      '<button type="button" data-pic="' + i + '" title="' + esc(im.name) + '">'
      + '<img src="' + esc(im.url) + '" alt="" loading="lazy"><small>' + esc(im.name)
      + '</small></button>').join('') + '</div>';
    g.querySelectorAll('[data-pic]').forEach(b => {
      b.onclick = () => { g.hidden = true; onPick(r.images[Number(b.dataset.pic)]); };
    });
  } catch (e) {
    g.innerHTML = '<p class="hint" style="margin:0;color:#7a2118">' + esc(e.message) + '</p>';
  }
}

function pictures() {
  const file = $('#picFile');
  const ta = $('#pBody');
  let target = 'body';                      // where the next chosen file goes

  const take = async f => {
    if (!f) return;
    if (!/^image\//.test(f.type || '')) { say('That is not a picture.', true); return; }
    say('Uploading ' + (f.name || 'picture') + '…');
    try {
      const im = await uploadPicture(f);
      say('');
      if (target === 'cover') setCover(im.url);
      else insertAtCursor(pictureLine(im, ''));
    } catch (e) { say(e.message, true); }
  };

  const setCover = url => {
    $('#pCover').value = url || '';
    $('#coverPrev').innerHTML = coverThumb(url);
    dirty = true;
  };

  $('#picAdd').onclick = () => { target = 'body'; file.value = ''; file.click(); };
  $('#coverUp').onclick = () => { target = 'cover'; file.value = ''; file.click(); };
  file.onchange = () => take(file.files && file.files[0]);
  $('#coverClear').onclick = () => setCover('');
  $('#pCover').addEventListener('input', () => {
    $('#coverPrev').innerHTML = coverThumb($('#pCover').value.trim());
    dirty = true;
  });
  $('#picPick').onclick = () => showGrid(im => insertAtCursor(pictureLine(im, '')));
  $('#coverPick').onclick = () => showGrid(im => setCover(im.url));

  /* Paste: a screenshot on the clipboard, or a file copied from a folder. */
  ta.addEventListener('paste', e => {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const pic = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!pic) return;
    e.preventDefault();
    target = 'body';
    take(pic.getAsFile());
  });
  /* Drop: a file dragged from the desktop onto the text. */
  ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('dropping'); });
  ta.addEventListener('dragleave', () => ta.classList.remove('dropping'));
  ta.addEventListener('drop', e => {
    ta.classList.remove('dropping');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    target = 'body';
    /* Where it was dropped, not where the cursor last was. */
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && pos.offsetNode === ta) ta.setSelectionRange(pos.offset, pos.offset);
    }
    take(f);
  });
}

/* --------------------------------------------- the glovels.com import */

let wixTimer = null;

function paintWix(st) {
  const bar = $('#wixBar'), said = $('#wixSaid'), items = $('#wixItems');
  if (!st || st.never) {
    bar.hidden = true; items.hidden = true;
    said.textContent = '';
    return;
  }
  bar.hidden = false;
  bar.firstElementChild.style.width = st.total ? Math.round(100 * st.done / st.total) + '%' : '0%';
  if (st.error) {
    said.textContent = st.error;
    said.style.color = '#7a2118';
  } else {
    said.style.color = '';
    said.textContent = (st.running ? 'Working — ' : 'Done. ')
      + st.done + ' of ' + st.total + ' read · ' + st.created + ' brought across'
      + (st.replaced ? ' · ' + st.replaced + ' replaced' : '')
      + ' · ' + st.skipped + ' already here · ' + st.failed + ' failed · '
      + st.pictures + ' pictures copied.';
  }
  const rows = (st.items || []).filter(i => i.result && i.result !== 'created').slice(-60);
  items.hidden = !rows.length;
  items.innerHTML = rows.map(i => '<div class="' + esc(i.result) + '">' + esc(i.slug)
    + ' — ' + esc(i.result) + (i.note ? ': ' + esc(i.note) : '') + '</div>').join('');
  $('#wixGo').disabled = !!st.running;
  $('#wixGo').textContent = st.running ? 'Working…' : 'Bring them across';
}

async function pollWix() {
  try {
    const r = await api('GET', '/api/staff/wix/status');
    paintWix(r.status);
    if (r.status && r.status.running) wixTimer = setTimeout(pollWix, 1500);
    else { wixTimer = null; await load(); }
  } catch (e) { $('#wixSaid').textContent = e.message; }
}

document.addEventListener('click', async e => {
  if (e.target.closest('#wixBtn')) {
    const box = $('#wixBox');
    if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) pollWix();
    return;
  }
  if (e.target.closest('#wixHide')) { $('#wixBox').hidden = true; return; }
  if (e.target.closest('#wixGo')) {
    $('#wixGo').disabled = true;
    try {
      await api('POST', '/api/staff/wix/import', { overwrite: $('#wixOver').checked });
      if (!wixTimer) pollWix();
    } catch (err) { $('#wixSaid').textContent = err.message; $('#wixGo').disabled = false; }
  }
});

function count(el, n, limit, low) {
  el.textContent = n + ' / ' + limit;
  el.className = 'cnt' + (n > limit ? ' over' : n >= low ? ' good' : '');
}

function preview() {
  const title = $('#pMetaTitle').value.trim() || $('#pTitle').value.trim();
  const body = $('#pBody').value;
  const desc = $('#pMetaDesc').value.trim() || $('#pExcerpt').value.trim()
    || body.split(/\n\s*\n/).filter(x => !/^\s*(#|-|\d+[.)]|>)/.test(x))[0] || '';
  const slug = $('#pSlug').value.trim() || slugify($('#pTitle').value);

  $('#sU').textContent = 'glovels.com/post/' + slug;
  $('#sT').textContent = (title || 'Your headline') + ' | Glovels';
  $('#sD').textContent = desc.slice(0, 300) || 'The sentence a student reads before deciding '
    + 'whether to click.';

  /* The window Google actually prints, not a maximum. Under 55 wastes the
     space; over 65 is cut off mid-word with an ellipsis, and the same for a
     description outside 155-165. The counter goes green inside the window and
     red past it, so the writer can see the target rather than guess it. */
  count($('#cTitle'), ($('#pMetaTitle').value.trim() || $('#pTitle').value.trim()).length,
    65, 55);
  count($('#cDesc'), ($('#pMetaDesc').value.trim() || desc).length, 165, 155);
  count($('#cExcerpt'), $('#pExcerpt').value.trim().length, 500, 80);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  $('#cWords').textContent = words.toLocaleString('en-IN') + ' words · about '
    + Math.max(1, Math.round(words / 220)) + ' min';
}

function body() {
  return {
    title: $('#pTitle').value.trim(),
    slug: $('#pSlug').value.trim(),
    tag: $('#pTag').value.trim(),
    excerpt: $('#pExcerpt').value.trim(),
    body: $('#pBody').value,
    metaTitle: $('#pMetaTitle').value.trim(),
    metaDesc: $('#pMetaDesc').value.trim(),
    keywords: $('#pKeywords').value.trim(),
    ogImage: $('#pOg').value.trim(),
    cover: $('#pCover').value.trim(),
    author: $('#pAuthor').value.trim(),
    publishedAt: $('#pPublished').value,
    related: [...$('#relPick').querySelectorAll('input:checked')]
      .map(b => b.value).join(','),
  };
}

async function save(status, p) {
  const err = $('#pErr');
  err.style.display = 'none';
  const data = Object.assign(body(), { status });
  const btn = status === 'published' ? $('#pPub') : $('#pSave');
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = p.id
      ? await api('PUT', '/api/staff/post/' + p.id, data)
      : await api('POST', '/api/staff/posts', data);
    dirty = false;
    openId = r.post.id;
    await load();
    editor(r.post);
    $('#pSaid').textContent = status === 'published'
      ? 'On the site — glovels.com/post/' + r.post.slug
      : 'Saved. Not on the site.';
    setTimeout(() => { if ($('#pSaid')) $('#pSaid').textContent = ''; }, 6000);
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = was;
  }
}

async function drop(p) {
  /* Unpublishing is one press; deleting something that was live is not
     offered at all, because the address has been shared and indexed. */
  const live = p.status === 'published';
  if (!live && !confirm('Delete “' + p.title + '”? It was never on the site, '
      + 'so nothing links to it.')) return;
  await api('DELETE', '/api/staff/post/' + p.id);
  openId = live ? p.id : null;
  await load();
  if (live) open_(p.id);
  else $('#editor').innerHTML = '<p style="margin:0;font-size:13px;color:var(--muted)">'
    + 'Deleted. Pick another post, or start a new one.</p>';
}

async function open_(id) {
  if (dirty && !confirm('You have unsaved changes. Leave them?')) return;
  const r = await api('GET', '/api/staff/post/' + id);
  openId = id;
  dirty = false;
  paintList();
  editor(r.post);
}

let loadReq = 0, loadTimer = null;
async function load() {
  const q = ($('#pq').value || '').trim(), st = $('#pst').value;
  const mine = ++loadReq;
  const r = await api('GET', '/api/staff/posts?page=' + (pageOf('post') + 1) + '&per=' + sizeOf('post')
    + (q ? '&q=' + encodeURIComponent(q) : '') + (st ? '&status=' + st : ''));
  if (mine !== loadReq) return;
  POSTS = r.posts; POST_TOTAL = r.total; STATS = r.stats || {};
  PAGE_AT.post = Math.max(0, (r.page || 1) - 1);
  paintList();
}
PAGE_SIZES.post = 100;
const loadSoon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => { load().catch(e => toast(e.message)); }, 220); };
$('#pq').addEventListener('input', () => { PAGE_AT.post = 0; loadSoon(); });
$('#pst').addEventListener('change', () => { PAGE_AT.post = 0; loadSoon(); });

document.addEventListener('click', e => {
  const row = e.target.closest('[data-post]');
  if (row) return open_(Number(row.dataset.post));
  if (e.target.closest('#newPost')) {
    if (dirty && !confirm('You have unsaved changes. Leave them?')) return;
    openId = null;
    dirty = false;
    paintList();
    editor({ status: 'draft' });
    $('#pTitle').focus();
  }
});

/* A tab closed mid-post is a post lost. The browser's own prompt is the only
   one that fires reliably here. */
addEventListener('beforeunload', e => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* Through staffBoot, like every other staff screen.
 *
 * "The identity block reads Website editor although this session is signed in
 *  as admin."
 *
 * It did, and the reason was not the label: this screen never called
 * staffBoot at all. So the name and the role were never filled in — the page
 * kept whatever was baked into its markup, which for this screen was "Website
 * editor" — the must-change-your-password screen never appeared, and somebody
 * without the content permission got a working-looking editor and a refusal
 * from the server on Save.
 *
 * The API has always refused the save. This is so the refusal is not the first
 * thing they learn about it, after writing a post. */
staffBoot(async me => {
  if ((me.user.perms || []).indexOf('content') < 0) {
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>You do not have access to the '
      + 'website</b><p>An administrator can give it to you on the Organisation screen '
      + '&mdash; it is a tick box beside your name.</p>'
      + '<a class="btn btn-primary" href="counsellor.html">Go to Conversations</a></div>';
    return;
  }
  await load();
});
"""
