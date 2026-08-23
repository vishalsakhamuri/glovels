"""
The corner of the screen, on the website and inside the portal.

Two modes, because the two audiences want different things and the business
wants different things from them.

  site    A marketing page. WhatsApp is the button people recognise and the one
          most Indian families will actually press, so it is the green one and
          it is first. The chat sits under it, quieter, for somebody who does
          not want to hand over a phone number to a stranger — and because a
          chat asks for a name and a number before the first message, which is
          what turns it into a lead in the enquiry book. WhatsApp conversations
          live in WhatsApp and never reach the operations site; that is the
          trade, made deliberately.

  portal  A signed-in student. No WhatsApp, no intro form, no asking who they
          are — the server already knows. The button opens their real thread
          with their counsellor, on whatever screen they are on, so a question
          does not mean navigating away from the document they were uploading.
          The Messages screen is still the full view.

The mode is set by a one-line script written above this one at build time. It
defaults to `site`, because the failure of guessing wrong that way is a portal
page offering WhatsApp, and the other way round is a marketing page asking a
stranger to sign in.

It is written plainly — `var`, no arrow functions, no template literals —
because it runs on whatever browser a parent in Hyderabad has open, and a syntax
error in a chat widget would take down the page it is sitting on.
"""

WIDGET = r"""
/* GLOVELS-CHAT-WIDGET */
(function () {
  if (window.__glovelsChat) return;
  window.__glovelsChat = true;
  if (location.protocol === 'file:') return;   /* no server behind it */

  var MODE = window.__glovelsChatMode === 'portal' ? 'portal' : 'site';
  var OPEN_KEY = 'glovels_chat_open';
  var state = { started: false, signedIn: false, msgs: [], unread: 0, name: '' };
  var es = null, panel = null, dot = null, wa = null;

  /* Baked in at build time and replaced by whatever the office has set on the
     Finder & contact tab. Having a number here means the button works on the
     first paint rather than appearing a second later, and still works if that
     request fails. */
  var WA_NUMBER = '917093314089';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var css = document.createElement('style');
  css.textContent = [
    '.gv-chat-fab{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;',
      'align-items:center;gap:9px;padding:13px 18px;border:0;border-radius:999px;',
      'background:#0b1e31;color:#fff;font:700 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'cursor:pointer;box-shadow:0 8px 26px rgba(11,30,49,.28)}',
    '.gv-chat-fab:hover{background:#13385c}',
    /* The corner holds a stack, not one button: WhatsApp first because it is
       the one people recognise, the chat under it in a quieter weight. */
    '.gv-corner{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;',
      'flex-direction:column;align-items:flex-end;gap:9px}',
    '.gv-wa{display:inline-flex;align-items:center;gap:9px;padding:13px 18px;border:0;',
      'border-radius:999px;background:#25d366;color:#08301a;text-decoration:none;',
      'font:700 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;',
      'box-shadow:0 8px 26px rgba(6,70,38,.32)}',
    '.gv-wa:hover{background:#1fbe5a}',
    '.gv-corner .gv-chat-fab{position:static;box-shadow:0 6px 18px rgba(11,30,49,.22);',
      'padding:10px 15px;font-size:13px;background:#fff;color:#13385c;',
      'border:1.5px solid #d3dbe4}',
    '.gv-corner .gv-chat-fab:hover{background:#f4f7fb}',
    '.gv-corner .gv-dot{top:-4px;right:-4px}',
    /* A class that sets display beats the browser's own rule for [hidden], so
       hiding the button by setting .hidden left it sitting on top of the open
       panel, swallowing clicks meant for Send. Both of these are load-bearing. */
    '.gv-chat-fab[hidden]{display:none}',
    '.gv-chat[hidden]{display:none}',
    '.gv-chat-fab .gv-dot{position:absolute;top:-3px;right:-3px;width:13px;height:13px;',
      'border-radius:50%;background:#c0392b;border:2px solid #fff}',
    '.gv-chat{position:fixed;right:20px;bottom:20px;z-index:9999;width:min(370px,calc(100vw - 32px));',
      'max-height:min(620px,calc(100vh - 40px));display:flex;flex-direction:column;',
      'background:#fff;border-radius:16px;overflow:hidden;',
      'box-shadow:0 18px 50px rgba(11,30,49,.32);font:400 14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.gv-chat header{background:#0b1e31;color:#fff;padding:15px 17px;display:flex;',
      'align-items:flex-start;gap:10px}',
    '.gv-chat header b{display:block;font-size:14.5px;line-height:1.35}',
    '.gv-chat header span{display:block;font-size:12.1px;opacity:.78;line-height:1.5;margin-top:2px}',
    '.gv-chat header button{margin-left:auto;background:transparent;border:0;color:#fff;',
      'font-size:20px;line-height:1;cursor:pointer;padding:0 2px;opacity:.85}',
    '.gv-chat .gv-body{flex:1;overflow-y:auto;padding:16px;background:#f7f7f4;',
      'display:flex;flex-direction:column;gap:10px;min-height:170px}',
    '.gv-msg{max-width:82%;padding:9px 13px;border-radius:14px;font-size:13.4px;line-height:1.62;',
      'white-space:pre-wrap;word-wrap:break-word}',
    '.gv-msg.me{align-self:flex-end;background:#13385c;color:#fff;border-bottom-right-radius:5px}',
    '.gv-msg.them{align-self:flex-start;background:#fff;color:#0e1a24;border:1px solid #e6e2d7;',
      'border-bottom-left-radius:5px}',
    '.gv-msg small{display:block;margin-top:4px;font-size:11px;opacity:.66}',
    '.gv-note{font-size:12.2px;color:#5b6b7e;line-height:1.6;text-align:center;padding:4px 8px}',
    '.gv-chat form{border-top:1px solid #e6e2d7;padding:12px;display:flex;flex-direction:column;gap:9px;background:#fff}',
    '.gv-chat input,.gv-chat textarea{width:100%;padding:10px 12px;border:1.5px solid #d8dde4;',
      'border-radius:10px;font:400 13.6px/1.5 inherit;color:#0e1a24;background:#fff;box-sizing:border-box}',
    '.gv-chat textarea{resize:none;min-height:44px;max-height:120px}',
    '.gv-chat input:focus,.gv-chat textarea:focus{outline:2px solid #1a4fb4;outline-offset:1px;border-color:#1a4fb4}',
    '.gv-chat .gv-go{background:#c9a24b;color:#0b1e31;border:0;border-radius:10px;padding:11px 14px;',
      'font:700 13.6px/1 inherit;cursor:pointer}',
    '.gv-chat .gv-go:hover{background:#b98f34}',
    '.gv-err{color:#7a2118;font-size:12.4px;line-height:1.5}',
    '.gv-priv{font-size:11.2px;color:#5b6b7e;line-height:1.5}',
    '@media (max-width:520px){.gv-chat{right:10px;left:10px;bottom:10px;width:auto}',
      '.gv-chat-fab{right:14px;bottom:14px}}',
  ].join('');
  document.head.appendChild(css);

  var corner = document.createElement('div');
  corner.className = 'gv-corner';

  var fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'gv-chat-fab';
  fab.setAttribute('aria-label', MODE === 'portal'
    ? 'Message your counsellor' : 'Send us a message on the site');
  fab.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>'
    + '<span>' + (MODE === 'portal' ? 'Message my counsellor' : 'Send a message')
    + '</span><span class="gv-dot" hidden></span>';
  dot = fab.querySelector('.gv-dot');

  /* What the visitor was reading, so the counsellor opens the conversation
     already knowing what it is about. The page title is an SEO sentence and
     makes a terrible opening line, so the first heading is preferred. */
  function pageName() {
    var h = document.querySelector('h1');
    var t = h ? h.textContent : '';
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length > 3 && t.length < 70) return t;
    return location.pathname === '/' ? 'your website' : location.pathname.replace(/^\//, '');
  }

  function waHref() {
    return 'https://wa.me/' + WA_NUMBER + '?text='
      + encodeURIComponent('Hi Glovels — I was reading ' + pageName()
        + ' on your website and I have a question.');
  }

  if (MODE === 'site') {
    wa = document.createElement('a');
    wa.className = 'gv-wa';
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.href = waHref();
    wa.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"'
      + ' aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1'
      + '-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1'
      + '-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6 0-.2-.7-1.6-.9-2.2'
      + '-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.1 1.3 3.3'
      + 'c.2.2 2.4 3.7 5.8 5.1.8.4 1.4.6 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.8-.7 2.1-1.5'
      + '.3-.7.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22'
      + 'l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3'
      + 'A8.2 8.2 0 1 1 12 20.2z"/></svg>'
      + '<span>WhatsApp us</span>';
    corner.appendChild(wa);
  }

  var api = function (path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'That did not go through. Try again in a moment.');
        return d;
      });
    });
  };

  var when = function (iso) {
    if (!iso) return '';
    var s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  function paint() {
    if (!panel) return;
    var body = panel.querySelector('.gv-body');
    if (!state.started && !state.signedIn) return;

    body.innerHTML = state.msgs.map(function (m) {
      return '<div class="gv-msg ' + (m.who === 'me' ? 'me' : 'them') + '">' + esc(m.t) +
        '<small>' + (m.who === 'me' ? 'You' : esc(m.name || 'Glovels')) + ' · ' +
        when(m.at) + '</small></div>';
    }).join('') || '';

    if (!state.msgs.length || state.msgs.every(function (m) { return m.who === 'me'; })) {
      body.insertAdjacentHTML('beforeend',
        '<p class="gv-note">This goes straight to a counsellor’s screen. If nobody is at a '
        + 'desk right now we will call you back — we have your number.</p>');
    }
    body.scrollTop = body.scrollHeight;
  }

  function intro() {
    return '<form class="gv-intro">'
      + '<p style="margin:0;font-size:13.2px;line-height:1.6;color:#0e1a24">Ask us anything about '
      + 'studying abroad. Tell us who you are first, so a counsellor can call you back.</p>'
      + '<input name="name" placeholder="Your name" autocomplete="name" required>'
      + '<input name="contact" placeholder="Mobile number or email" autocomplete="tel" required>'
      + '<p class="gv-err" hidden></p>'
      + '<button type="submit" class="gv-go">Start the chat</button>'
      + '<p class="gv-priv">We use this to answer you and to call you back. Nothing else.</p>'
      + '</form>';
  }

  function composer() {
    return '<form class="gv-send">'
      + '<textarea name="body" rows="2" placeholder="Type your question…" required></textarea>'
      + '<p class="gv-err" hidden></p>'
      + '<button type="submit" class="gv-go">Send</button>'
      + '</form>';
  }

  function render() {
    panel.innerHTML =
        '<header><div><b>' + (state.signedIn ? 'Your counsellor' : 'Glovels') + '</b>'
      + '<span>' + (state.signedIn
          ? 'This is the same conversation as your Messages screen.'
          : 'Mon–Sat, 10am–7pm. Replies appear here.') + '</span></div>'
      + '<button type="button" aria-label="Close the chat">×</button></header>'
      + '<div class="gv-body"></div>'
      + ((state.started || state.signedIn) ? composer() : intro());
    paint();

    panel.querySelector('header button').onclick = close;

    var form = panel.querySelector('form');
    form.onsubmit = function (e) {
      e.preventDefault();
      var err = form.querySelector('.gv-err');
      err.hidden = true;
      var go = form.querySelector('.gv-go');
      go.disabled = true;

      var done = function (d) {
        state.started = true;
        state.signedIn = !!d.signedIn;
        state.msgs = d.messages || [];
        render();
        var box = panel.querySelector('textarea');
        if (box) box.focus();
        listen();
      };
      var failed = function (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        go.disabled = false;
      };

      if (form.classList.contains('gv-intro')) {
        api('/api/chat/start', {
          name: form.name.value, contact: form.contact.value,
          page: location.pathname,
        }).then(done, failed);
      } else {
        var text = form.body.value.trim();
        if (!text) { go.disabled = false; return; }
        /* Painted before the round trip so the box empties the instant Enter is
           pressed. The server's answer replaces the list a moment later. */
        state.msgs = state.msgs.concat([{ who: 'me', t: text, at: new Date().toISOString() }]);
        form.body.value = '';
        paint();
        api('/api/chat/send', { body: text }).then(done, failed);
      }
    };

    var ta = panel.querySelector('textarea');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          panel.querySelector('form').requestSubmit
            ? panel.querySelector('form').requestSubmit()
            : panel.querySelector('.gv-go').click();
        }
      });
      ta.addEventListener('input', function () {
        ta.style.height = 'auto';
        ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      });
    }
  }

  /* The stream. A guest listens on their own chat; a signed-in student listens
     on the portal's stream, which is the one their counsellor replies down. */
  function listen() {
    if (es || !window.EventSource) return;
    try {
      es = new EventSource(state.signedIn ? '/api/live' : '/api/chat/live');
    } catch (e) { return; }

    var arrive = function (m) {
      state.msgs = state.msgs.concat([m]);
      if (!panel || panel.hidden) {
        state.unread++;
        if (dot) dot.hidden = false;
      }
      paint();
    };

    es.addEventListener('chat', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (d.who === 'them') arrive({ who: 'them', t: d.t, name: d.name, at: d.at });
      } catch (e) {}
    });
    es.addEventListener('message', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        var m = d.msg || d;
        if (m && m.who === 'them') arrive({ who: 'them', t: m.t, at: m.at });
      } catch (e) {}
    });
  }

  /* The corner hides only the chat button when the panel is open. WhatsApp
     stays: somebody who opened the chat, read the "we will call you back" line
     and decided they would rather have an instant reply should not have to
     close anything to reach it. */
  function open() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'gv-chat';
      document.body.appendChild(panel);
    }
    panel.hidden = false;
    fab.hidden = true;
    state.unread = 0;
    if (dot) dot.hidden = true;
    try { sessionStorage.setItem(OPEN_KEY, '1'); } catch (e) {}
    render();
    var f = panel.querySelector('input, textarea');
    if (f) f.focus();
  }

  function close() {
    if (panel) panel.hidden = true;
    fab.hidden = false;
    try { sessionStorage.removeItem(OPEN_KEY); } catch (e) {}
  }

  fab.onclick = open;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel && !panel.hidden) close();
  });

  function boot() {
    /*
     * One button in the corner of the marketing pages, not two.
     *
     * WhatsApp and "Send a message" sat stacked on top of each other, and the
     * pair read as clutter rather than as choice. On the site the corner is
     * WhatsApp — it is where this office actually answers people, and it is
     * what was asked for. The chat box stays exactly where it earns its keep:
     * inside the student portal, where it is the counsellor thread.
     *
     * The lead capture that made the site chat worth having has not gone with
     * it. The contact page carries a form that writes an enquiry, and the
     * counselling form on the home page always has.
     */
    if (MODE !== 'site') corner.appendChild(fab);
    document.body.appendChild(corner);

    api('/api/chat').then(function (d) {
      state.signedIn = !!d.signedIn;
      state.msgs = d.messages || [];
      state.started = state.signedIn || state.msgs.length > 0 || d.id != null;

      /* A portal screen with nobody signed in should not be showing a button
         that opens somebody's counsellor thread. In practice the screen has
         already redirected to sign-in by now; this is the belt to that brace. */
      if (MODE === 'portal' && !state.signedIn) {
        corner.remove();
        return;
      }

      if (state.started) listen();
      var wasOpen = false;
      try { wasOpen = sessionStorage.getItem(OPEN_KEY) === '1'; } catch (e) {}
      if (wasOpen) open();
    }, function () { /* server down: the button still opens the intro */ });

    /* The office's number, as set on the Finder & contact tab. The button
       already works with the number baked in above; this corrects it. */
    if (wa) {
      fetch('/api/content', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var n = d && d.finder && d.finder.contact && d.finder.contact.whatsapp;
          if (n) { WA_NUMBER = n; wa.href = waHref(); }
        })
        .catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
"""
