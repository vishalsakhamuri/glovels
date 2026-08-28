#!/usr/bin/env python3
"""
Turning notifications on, from the phone in the counsellor's hand.

The operations screens stream while they are open. On a phone that is the whole
problem — the tab is not open, it is a browser somebody closed at six, and a
student writing at nine reaches nobody until the morning.

Three things have to line up, and each of them fails silently on its own:

  the page has to be served over HTTPS, or the browser refuses to register a
  service worker at all and says nothing a person would notice;

  on an iPhone the site has to have been added to the Home Screen first —
  Safari refuses the permission prompt otherwise, and has done since the day
  Web Push shipped there;

  and the person has to say yes. Once. A "denied" is remembered by the browser
  and cannot be re-asked from script, which is why the button below explains
  what it is for BEFORE asking rather than firing the prompt on page load.
  A prompt nobody expected is a prompt that gets dismissed, permanently.

So this renders as a small bar at the top of the staff screens, and says
exactly which of the three is in the way when it is.
"""

BAR = """
    <div id="pushBar" hidden style="display:flex;gap:11px;align-items:center;flex-wrap:wrap;
      background:#eef4fd;border:1px solid #cfdcf3;border-radius:12px;padding:11px 14px;
      margin-bottom:16px;font:600 12.8px/1.5 var(--sans);color:#123a7b">
      <svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>
      <span id="pushMsg" style="flex:1;min-width:200px"></span>
      <button type="button" class="btn btn-primary btn-sm" id="pushOn" hidden>
        Turn on notifications</button>
      <button type="button" class="btn btn-ghost btn-sm" id="pushTest" hidden>
        Send me a test</button>
      <button type="button" class="btn btn-ghost btn-sm" id="pushOff" hidden>Turn off</button>
    </div>
"""

_SCRIPT = r"""
/* Notifications on this device. */
(function () {
  const OFFER = %OFFER%;
  const IOS_HINT = %IOS_HINT%;
  const bar = document.getElementById('pushBar');
  if (!bar) return;
  const msg = document.getElementById('pushMsg');
  const on = document.getElementById('pushOn');
  const test = document.getElementById('pushTest');
  const off = document.getElementById('pushOff');

  const show = (text, buttons) => {
    bar.hidden = false;
    msg.textContent = text;
    on.hidden = !buttons.includes('on');
    test.hidden = !buttons.includes('test');
    off.hidden = !buttons.includes('off');
  };

  /* iOS refuses to register a service worker's push subscription until the site
     is on the Home Screen. Detecting that is the difference between "add this
     to your Home Screen and it will work" and a permission prompt that appears
     to do nothing. */
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (iOS && !installed) {
      show(IOS_HINT, []);
    }
    return;
  }
  if (!window.isSecureContext) return;      /* http on a laptop — nothing to offer */

  let reg = null, key = null;

  async function state() {
    reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription();
    if (sub) return show('Notifications are on for this device.', ['test', 'off']);
    if (Notification.permission === 'denied') {
      return show('Notifications are blocked for this site in your browser settings. '
        + 'Allow them there and reload.', []);
    }
    if (iOS && !installed) {
      return show(IOS_HINT, []);
    }
    show(OFFER, ['on']);
  }

  const raw = b64 => {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  };

  on.addEventListener('click', async () => {
    on.disabled = true;
    on.textContent = 'Asking…';
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        /* Denied is permanent from script's point of view — say so plainly
           rather than leaving a button that can never work again. */
        show(p === 'denied'
          ? 'You said no. Allow notifications for this site in your browser settings '
            + 'if you change your mind.'
          : 'No answer — tap the button again when you are ready.', p === 'denied' ? [] : ['on']);
        return;
      }
      if (!key) key = (await (await fetch('/api/push/key',
        { credentials: 'same-origin' })).json()).key;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: raw(key),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      show('Notifications are on for this device.', ['test', 'off']);
    } catch (e) {
      show('That did not work: ' + (e.message || e), ['on']);
    } finally {
      on.disabled = false;
      on.textContent = 'Turn on notifications';
    }
  });

  test.addEventListener('click', async () => {
    test.disabled = true;
    const was = test.textContent;
    test.textContent = 'Sending…';
    try {
      const r = await (await fetch('/api/push/test',
        { method: 'POST', credentials: 'same-origin' })).json();
      test.textContent = r.sent ? 'Sent — check your phone' : 'Nothing sent';
    } catch (e) {
      test.textContent = 'Failed';
    }
    setTimeout(() => { test.disabled = false; test.textContent = was; }, 3000);
  });

  off.addEventListener('click', async () => {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
    show(OFFER, ['on']);
  });

  state().catch(() => {});
})();
"""


# The two sentences that differ between the two apps, and nothing else does.
#
# A counsellor is told a student has written; a student is told their counsellor
# has replied. Same three failure modes, same bar, same permission — so the code
# is shared and the words are not, rather than the file being copied and the two
# copies drifting the first time one of them is fixed.
def script(offer, ios_hint):
    import json as _json
    return (_SCRIPT
            .replace("%OFFER%", _json.dumps(offer))
            .replace("%IOS_HINT%", _json.dumps(ios_hint)))


# What the office sees. Bound to the old name so build_portal.py does not have
# to change in the same patch as the behaviour.
SCRIPT = script(
    "Get a notification when one of your students writes, even with this closed.",
    "To get a buzz when a student writes: tap Share, then Add to Home Screen, "
    "and open this site from there.",
)

# And what a student sees. The wording is the whole difference: the thing they
# are waiting for is a person answering them, and saying so is what makes the
# permission prompt worth granting rather than one more thing to dismiss.
STUDENT_SCRIPT = script(
    "Get a notification the moment your counsellor replies, even with Glovels closed.",
    "To get a buzz when your counsellor replies: tap Share, then Add to Home Screen, "
    "and open Glovels from there.",
)
