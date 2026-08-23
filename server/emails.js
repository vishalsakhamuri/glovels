'use strict';
/**
 * The emails themselves.
 *
 * Every one is written twice — plain text and HTML — because a mail client that
 * blocks HTML must still show a usable message, and because a text part is what
 * keeps a mail out of the spam folder.
 *
 * House rules, from the site's own copy:
 *   - No exclamation marks and no "Dear valued customer".
 *   - Say what happens next and when. A confirmation that does not tell you the
 *     next step is a receipt, not a message.
 *   - Never promise something the system cannot do. If a counsellor calls
 *     within one working day, say that; do not say "immediately".
 */

const money = paise => '₹' + Number(paise / 100).toLocaleString('en-IN');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* One shell, so every message looks like it came from the same company. Inline
   styles only: every mail client strips <style> blocks. */
function shell(title, bodyHtml, footNote) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f7f5ef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ef;padding:26px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e2d7;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0b1e31;padding:20px 26px">
    <span style="font:700 19px/1 Georgia,serif;color:#ffffff;letter-spacing:.02em">GLOVELS</span>
    <span style="font:600 10px/1 Helvetica,Arial,sans-serif;color:#c8d6e4;letter-spacing:.16em;text-transform:uppercase;padding-left:10px">Education · Visa · Work</span>
  </td></tr>
  <tr><td style="padding:26px">
    <h1 style="margin:0 0 14px;font:700 21px/1.3 Georgia,serif;color:#0b1e31">${esc(title)}</h1>
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:16px 26px;background:#f7f5ef;border-top:1px solid #e6e2d7;
      font:400 11.5px/1.6 Helvetica,Arial,sans-serif;color:#5b6b7e">
    ${footNote || 'Glovels · Hyderabad · <a href="tel:+917093314089" style="color:#123a7b">+91 70933 14089</a> · <a href="mailto:info@glovels.com" style="color:#123a7b">info@glovels.com</a>'}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

const p = t => `<p style="margin:0 0 13px;font:400 14.5px/1.65 Helvetica,Arial,sans-serif;color:#0e1a24">${t}</p>`;
const small = t => `<p style="margin:0 0 13px;font:400 12.6px/1.6 Helvetica,Arial,sans-serif;color:#5b6b7e">${t}</p>`;
const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#1a4fb4;color:#ffffff;
   font:700 14px/1 Helvetica,Arial,sans-serif;text-decoration:none;padding:14px 22px;border-radius:10px">${esc(label)}</a></p>`;

const rows = pairs => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
  style="margin:0 0 16px;border:1px solid #e6e2d7;border-radius:10px;border-collapse:separate">
  ${pairs.map(([k, v], i) => `<tr>
    <td style="padding:10px 14px;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#5b6b7e;${i ? 'border-top:1px solid #e6e2d7' : ''}">${esc(k)}</td>
    <td style="padding:10px 14px;font:600 13px/1.5 Helvetica,Arial,sans-serif;color:#0b1e31;text-align:right;${i ? 'border-top:1px solid #e6e2d7' : ''}">${esc(v)}</td>
  </tr>`).join('')}
</table>`;

/* --------------------------------------------------------------- templates */

const T = {

  welcome({ name, email, siteUrl }) {
    const first = String(name || '').split(' ')[0] || 'there';
    return {
      subject: 'Your Glovels account is ready',
      text: `Hi ${first},

Your Glovels account is set up. Everything to do with your application now lives in one place — your shortlist, your documents, your deadlines and your counsellor.

Sign in: ${siteUrl}/login
Your email: ${email}

Two things worth doing first:

1. Fill in your profile. It is eleven short sections, and it is what we use to write your SOP, brief your recommenders and build your visa checklist. It is only asked once.
2. Upload your passport and marksheets. Your counsellor verifies each file before it goes anywhere.

If anything is unclear, message your counsellor from the portal — it goes on your file, so nobody is ever working from memory.

Glovels
+91 70933 14089`,
      html: shell('Your account is ready',
        p(`Hi ${esc(first)},`) +
        p('Your Glovels account is set up. Everything to do with your application now lives in one place — your shortlist, your documents, your deadlines and your counsellor.') +
        rows([['Sign in with', email]]) +
        button(siteUrl + '/login', 'Open my dashboard') +
        p('<b>Two things worth doing first:</b>') +
        p('<b>1. Fill in your profile.</b> Eleven short sections. It is what we use to write your SOP, brief your recommenders and build your visa checklist — so it is only asked once.') +
        p('<b>2. Upload your passport and marksheets.</b> Your counsellor verifies each file before it goes anywhere.') +
        small('If anything is unclear, message your counsellor from the portal. It goes on your file, so nobody is ever working from memory.')),
    };
  },

  /*
   * The account we made for somebody, and how they get into it.
   *
   * A password is never in this email. It is not squeamishness: email is stored
   * unencrypted on several machines and forwarded without thinking, and a
   * password that has been emailed is a password that stays readable in an
   * inbox for years. A link that works once and expires cannot be reused by
   * whoever reads the mailbox next.
   */
  invite({ name, email, link, days, siteUrl, reference }) {
    const first = String(name || '').split(' ')[0] || 'there';
    const bought = reference
      ? `Your order ${reference} is already on it, along with the universities it unlocked.`
      : 'Your counsellor set it up for you.';
    return {
      subject: 'Your Glovels account — choose a password',
      text: `Hi ${first},

We have made your Glovels account. ${bought}

Choose your password here — the link works once and lasts ${days} days:
${link}

Your sign-in email is ${email}.

Inside you will find your shortlist, your documents, your deadlines and a direct line to your counsellor.

If you did not ask for this, ignore it — the link expires on its own and nothing happens.

Glovels
+91 70933 14089`,
      html: shell('Your account is ready',
        p(`Hi ${esc(first)},`) +
        p(`We have made your Glovels account. ${esc(bought)}`) +
        button(link, 'Choose my password') +
        rows([['Your sign-in email', email], ['This link lasts', days + ' days']]) +
        p('Inside you will find your shortlist, your documents, your deadlines and a direct '
          + 'line to your counsellor.') +
        small('The link works once. If you did not ask for this, ignore it — it expires on '
          + 'its own and nothing happens.')),
    };
  },

  /*
   * The account, and the password to open it with once.
   *
   * A password in an email is a password that stays readable in a mailbox for
   * years, so this one is built to be replaced: the account refuses to do
   * anything until the person has chosen their own, and the message says so
   * plainly rather than burying it.
   */
  credentials({ name, email, password, siteUrl, role, madeBy }) {
    const first = String(name || '').split(' ')[0] || 'there';
    const what = role === 'student' || !role
      ? 'your Glovels student account'
      : 'your Glovels ' + role + ' account';
    const who = madeBy ? ` ${madeBy} set it up for you.` : '';
    return {
      subject: 'Your Glovels sign-in',
      text: `Hi ${first},

We have made ${what}.${who}

Sign in: ${siteUrl}/login
Email:    ${email}
Password: ${password}

That password is temporary. The first time you sign in you will be asked to choose your own, and nothing works until you do — so this message stops being useful the moment you have used it. Delete it then.

Glovels
+91 70933 14089`,
      html: shell('Your Glovels sign-in',
        p(`Hi ${esc(first)},`) +
        p(`We have made ${esc(what)}.${esc(who)}`) +
        rows([['Email', email], ['Temporary password', password]]) +
        button(siteUrl + '/login', 'Sign in and choose a password') +
        p('<b>That password is temporary.</b> The first time you sign in you will be asked to '
          + 'choose your own, and nothing works until you do.') +
        small('Which means this message stops being useful the moment you have used it. '
          + 'Delete it then.')),
    };
  },

  orderReceipt({ name, email, reference, packageName, grossPaise, publicUnis, siteUrl,
    hasAccount, services }) {
    const first = String(name || '').split(' ')[0] || 'there';
    const tax = Math.round(grossPaise - grossPaise / 1.18);
    /* A receipt for services has to name them. "2 services — ₹4,498" is not a
       receipt, it is a bank statement line. */
    const bought = (services || []).length
      ? '\n' + services.map(x => '  \u00b7 ' + x).join('\n') + '\n' : '';
    /* "Your universities" is right for a package and wrong for a receipt that
       bought an SOP rewrite. */
    const what = (services || []).length ? 'This order is' : 'Your universities are';
    const nextStep = hasAccount
      ? `${what} in your dashboard now: ${siteUrl}/dashboard`
      : `Create your account with this email address and ${(services || []).length
          ? 'this order is' : 'your universities are'} attached straight away: `
        + `${siteUrl}/login?signup=1&email=${encodeURIComponent(email)}`;
    return {
      subject: `Your Glovels order ${reference} — ${packageName}`,
      text: `Hi ${first},

${(services || []).length
  ? `You have booked:${bought}`
  : `Your ${packageName} package is active.`}
Order reference   ${reference}
Amount            ${money(grossPaise)} (including ${money(tax)} GST)${publicUnis
  ? `
Universities      ${publicUnis} public universities unlocked` : ''}

${nextStep}

What happens next:

1. A counsellor calls you within one working day, Mon–Sat 9:30–19:30 IST, to agree your shortlist with you. That agreed shortlist is what the guarantee applies to.
2. Upload your documents in the portal. Start with the passport and your transcripts — the APS certificate for Germany takes 6–8 weeks, so it is the one to begin first.
3. We file in deadline order, and follow every application up until there is a decision on record.

Admission is the university's decision, not ours. What we guarantee is that your file is the strongest it can be and that nothing is left unchased.

Glovels
+91 70933 14089`,
      html: shell(packageName + ' is active',
        p(`Hi ${esc(first)},`) +
        rows([
          ['Order reference', reference],
          ['Package', packageName],
          ['Amount paid', money(grossPaise) + ' incl. GST'],
          ['GST @ 18%', money(tax)],
          ['Universities unlocked', String(publicUnis)],
        ]) +
        (hasAccount
          ? button(siteUrl + '/dashboard', 'Open my dashboard')
          : p('Create your account with <b>' + esc(email) + '</b> and your universities are attached straight away.')
            + button(siteUrl + '/login?signup=1&email=' + encodeURIComponent(email), 'Create my account')) +
        p('<b>What happens next</b>') +
        p('<b>1.</b> A counsellor calls you within one working day, Mon–Sat 9:30–19:30 IST, to agree your shortlist. That agreed shortlist is what the guarantee applies to.') +
        p('<b>2.</b> Upload your documents. Start with your passport and transcripts — the APS certificate for Germany takes 6–8 weeks, so begin that one first.') +
        p('<b>3.</b> We file in deadline order and follow every application up until a decision is on record.') +
        small('Admission is the university\'s decision, not ours. What we guarantee is that your file is the strongest it can be and that nothing is left unchased.')),
    };
  },

  passwordReset({ name, link, minutes }) {
    const first = String(name || '').split(' ')[0] || 'there';
    return {
      subject: 'Reset your Glovels password',
      text: `Hi ${first},

Someone asked to reset the password on your Glovels account. If that was you, use this link:

${link}

It works once, and expires in ${minutes} minutes.

If it was not you, you can ignore this — nothing has changed, and your current password still works.

Glovels
+91 70933 14089`,
      html: shell('Reset your password',
        p(`Hi ${esc(first)},`) +
        p('Someone asked to reset the password on your Glovels account. If that was you:') +
        button(link, 'Set a new password') +
        small(`This link works once and expires in ${minutes} minutes.`) +
        small('If it was not you, ignore this message. Nothing has changed and your current password still works.')),
    };
  },

  enquiryToOffice({ name, phone, email, destination, sourcePage, note }) {
    /* `note` carries what they were looking at when they asked — the
       university and programme they pressed Apply on. A lead that says only
       which country is a lead the counsellor starts from nothing. */
    return {
      subject: note ? `${note} — ${name}` : `Counselling request — ${name}`,
      text: `A ${note ? 'request to apply' : 'counselling request'} came in from the website.

Name         ${name}
Mobile       ${phone}
Email        ${email}
Destination  ${destination || 'Not specified'}${note ? `
About        ${note}` : ''}
Page         ${sourcePage || '/'}

They are expecting a call back within one working day.`,
      html: shell(note ? 'Request to apply' : 'Counselling request',
        rows([
          ['Name', name], ['Mobile', phone], ['Email', email],
          ['Destination', destination || 'Not specified'],
        ].concat(note ? [['About', note]] : []).concat([['Page', sourcePage || '/']])) +
        p('They are expecting a call back within one working day.')),
    };
  },

  enquiryToStudent({ name, destination }) {
    const first = String(name || '').split(' ')[0] || 'there';
    return {
      subject: 'We have your counselling request',
      text: `Hi ${first},

We have your request${destination ? ' about studying in ' + destination : ''}, and a counsellor will call you within one working day — Mon–Sat, 9:30–19:30 IST.

There is nothing to pay and no obligation. The call is to understand where you are, tell you honestly what is realistic for your profile, and answer whatever you want to ask.

If it is urgent, WhatsApp is faster: https://wa.me/917093314089

Glovels
+91 70933 14089`,
      html: shell('We have your request',
        p(`Hi ${esc(first)},`) +
        p(`We have your request${destination ? ' about studying in <b>' + esc(destination) + '</b>' : ''}, and a counsellor will call you <b>within one working day</b> — Mon–Sat, 9:30–19:30 IST.`) +
        p('There is nothing to pay and no obligation. The call is to understand where you are, tell you honestly what is realistic for your profile, and answer whatever you want to ask.') +
        button('https://wa.me/917093314089', 'WhatsApp us instead') +
        small('If it is urgent, WhatsApp is faster than waiting for the call.')),
    };
  },

  newStudentMessage({ studentName, studentEmail, body, siteUrl }) {
    return {
      subject: `New message from ${studentName}`,
      text: `${studentName} (${studentEmail}) wrote:

"${body}"

Reply from your counsellor workspace: ${siteUrl}/counsellor`,
      html: shell('New message from ' + studentName,
        p('<b>' + esc(studentName) + '</b> <span style="color:#5b6b7e">(' + esc(studentEmail) + ')</span> wrote:') +
        `<blockquote style="margin:0 0 16px;padding:13px 15px;background:#f7f5ef;border-left:3px solid #1a4fb4;
          border-radius:0 8px 8px 0;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#0e1a24">${esc(body)}</blockquote>` +
        button(siteUrl + '/counsellor', 'Open my workspace')),
    };
  },

  counsellorReplied({ studentName, counsellorName, body, siteUrl }) {
    const first = String(studentName || '').split(' ')[0] || 'there';
    return {
      subject: `${counsellorName} replied to you`,
      text: `Hi ${first},

${counsellorName} replied to your message:

"${body}"

Read it and reply here: ${siteUrl}/messages`,
      html: shell(counsellorName + ' replied',
        p(`Hi ${esc(first)},`) +
        `<blockquote style="margin:0 0 16px;padding:13px 15px;background:#f7f5ef;border-left:3px solid #1a4fb4;
          border-radius:0 8px 8px 0;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#0e1a24">${esc(body)}</blockquote>` +
        button(siteUrl + '/messages', 'Read and reply')),
    };
  },
};

module.exports = T;
