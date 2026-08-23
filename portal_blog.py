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
    </style>

    <div class="out tiles" style="--tiles:4;margin:0 0 18px">
      <div><b id="kLive">—</b><span>On the site</span></div>
      <div><b id="kDraft">—</b><span>Drafts</span></div>
      <div><b id="kEmpty">—</b><span>Written but empty</span></div>
      <div><b id="kWords">—</b><span>Words published</span></div>
    </div>

    <div class="blog-cols">
      <div class="p-card" style="padding:0">
        <div style="padding:12px 15px;border-bottom:1px solid var(--line);display:flex;
          gap:10px;align-items:center">
          <b style="font:700 12.4px/1 var(--sans);letter-spacing:.07em;
            text-transform:uppercase;color:var(--muted)">Posts</b>
          <button type="button" class="btn btn-primary btn-sm" id="newPost"
            style="margin-left:auto">+ New</button>
        </div>
        <ul class="plist" id="postList"></ul>
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
let POSTS = [], openId = null, dirty = false;

const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' });
};

/* Kept in step with the server's slugify. A writer who sees one address here
   and another one on the live post has been lied to by the screen. */
const slugify = s => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 80) || 'post';

function paintList() {
  const live = POSTS.filter(p => p.status === 'published');
  const draft = POSTS.filter(p => p.status !== 'published');
  $('#kLive').textContent = live.length;
  $('#kDraft').textContent = draft.length;
  $('#kEmpty').textContent = POSTS.filter(p => !p.words).length;
  $('#kWords').textContent = live.reduce((n, p) => n + (p.words || 0), 0)
    .toLocaleString('en-IN');

  $('#postList').innerHTML = POSTS.map(p =>
    '<li data-post="' + p.id + '"' + (p.id === openId ? ' class="on"' : '') + '>'
    + '<b>' + esc(p.title) + '</b>'
    + '<span><span class="stpill ' + (p.status === 'published' ? 'live">On the site'
        : 'draft">Draft') + '</span> '
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
          : 'draft">Draft') + '</span>'
      + '<span style="flex:1"></span>'
      + (isNew ? '' : '<a class="btn btn-ghost btn-sm" id="pView" target="_blank" '
        + 'href="/post/' + esc(p.slug) + '">View the page</a>')
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

    + '<div class="field"><label for="pExcerpt">The line under the headline'
      + '<small> — shown on the blog list and at the top of the post</small></label>'
      + '<textarea id="pExcerpt" rows="2" placeholder="Leave it empty and we use your '
      + 'first two sentences.">' + esc(p.excerpt || '') + '</textarea></div>'

    + '<div class="field"><label for="pBody">The post'
      + '<span class="cnt" id="cWords">0 words</span></label>'
      + '<textarea id="pBody" placeholder="Write it the way you would type it.">'
      + esc(p.body || '') + '</textarea></div>'

    + '<div class="helpbox" style="margin-bottom:20px">'
      + '<b>Four things the box understands.</b> '
      + '<code>## Heading</code> makes a heading &middot; '
      + '<code>- item</code> on its own line makes a list &middot; '
      + '<code>[words](https://…)</code> makes a link &middot; '
      + '<code>**bold**</code>. A blank line starts a new paragraph. '
      + 'Anything else is printed as you typed it.'
    + '</div>'

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
        + '<small>optional</small></label>'
        + '<input id="pOg" value="' + esc(p.ogImage || '') + '" '
        + 'placeholder="https://www.glovels.com/og/blocked-account.jpg"></div>'
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

  $('#pSave').onclick = () => save('draft', p);
  $('#pPub').onclick = () => save('published', p);
  if ($('#pDrop')) $('#pDrop').onclick = () => drop(p);
  preview();
}

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

  count($('#cTitle'), ($('#pMetaTitle').value.trim() || $('#pTitle').value.trim()).length, 60, 25);
  count($('#cDesc'), ($('#pMetaDesc').value.trim() || desc).length, 155, 70);
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
  const r = await api('DELETE', '/api/staff/post/' + p.id);
  POSTS = r.posts;
  openId = live ? p.id : null;
  paintList();
  if (live) { const now = POSTS.find(x => x.id === p.id); if (now) open_(now.id); }
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

async function load() {
  const r = await api('GET', '/api/staff/posts');
  POSTS = r.posts;
  paintList();
}

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

load();
"""
