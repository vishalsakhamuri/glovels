'use strict';
/**
 * What changes between a laptop and the internet.
 *
 * The difference is not cosmetic. On a laptop the server creates three demo
 * accounts with the password `glovels123`, one of them an administrator, and
 * that password is written in the README. On a public address that is an open
 * door to every student's passport scan.
 *
 * So production is a mode, and it refuses to start until the things that make
 * it safe are actually set. Refusing to boot is the correct behaviour: a server
 * that starts anyway and prints a warning nobody reads is how this goes wrong.
 */

const DEV_PASSWORD = 'glovels123';

function bool(v, dflt) {
  if (v == null || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function load(env) {
  env = env || process.env;

  const mode = (env.GLOVELS_ENV || env.NODE_ENV || 'development').toLowerCase();
  const production = mode === 'production';

  const cfg = {
    mode,
    production,
    port: Number(env.PORT) || 8080,
    /* 0.0.0.0 on a host, so the platform's router can reach it. Left as-is on a
       laptop, where 0.0.0.0 also means "anyone on this wi-fi", which is exactly
       what you want when counsellors are testing from their own machines. */
    host: env.HOST || '0.0.0.0',
    /* RENDER_EXTERNAL_URL is set by Render itself and is the address the site
       is actually reachable at. It is a fallback rather than the first choice
       because a custom domain must win over the platform's own one — otherwise
       every password-reset link points at glovels.onrender.com after the domain
       is switched over. */
    siteUrl: (env.GLOVELS_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),

    /* Behind a platform's load balancer the connection to this process is plain
       HTTP even though the visitor is on HTTPS. Without trusting the forwarded
       header the cookie never gets Secure and the sign-in links come out http://
       — which browsers now block on a secure page. */
    trustProxy: bool(env.TRUST_PROXY, production),
    secureCookies: bool(env.SECURE_COOKIES, production),

    seedDemo: bool(env.SEED_DEMO, !production),
    /* A shared test link wants the demo accounts — that is the point of it —
       but not with the password from the README. Supply one and they are
       created with it instead. */
    demoPassword: env.DEMO_PASSWORD || '',
    admin: {
      email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
      password: env.ADMIN_PASSWORD || '',
      name: env.ADMIN_NAME || 'Glovels Admin',
    },

    /* Sign-in throttling. Pointless on a laptop, essential the moment the URL is
       public — an unthrottled login form is a password guesser's free lunch. */
    maxLoginAttempts: Number(env.MAX_LOGIN_ATTEMPTS) || 8,
    loginWindowMs: (Number(env.LOGIN_WINDOW_MINUTES) || 15) * 60000,

    dataDir: env.DATA_DIR || '',
  };

  const problems = [];

  if (production) {
    if (!cfg.siteUrl) {
      problems.push('GLOVELS_URL is not set, and the host did not supply one either. '
        + 'Password-reset links and order emails are built from it, so without it they '
        + 'point at localhost.');
    } else if (!/^https:\/\//i.test(cfg.siteUrl)) {
      problems.push(`GLOVELS_URL is "${cfg.siteUrl}". Production must be https:// — a session `
        + 'cookie over plain HTTP is readable by anyone on the network.');
    }
    if (cfg.seedDemo && !cfg.demoPassword) {
      problems.push('SEED_DEMO is on in production without DEMO_PASSWORD. Those accounts '
        + 'would be created with the password published in the README, and one of them '
        + 'is an administrator. Set DEMO_PASSWORD, or leave SEED_DEMO off.');
    }
    if (cfg.seedDemo && cfg.demoPassword === DEV_PASSWORD) {
      problems.push('DEMO_PASSWORD is the one from the README. Pick another.');
    }
    if (cfg.seedDemo && cfg.demoPassword && cfg.demoPassword.length < 10) {
      problems.push('DEMO_PASSWORD is under 10 characters, and this link is public.');
    }
    if (!cfg.admin.email || !cfg.admin.password) {
      problems.push('ADMIN_EMAIL and ADMIN_PASSWORD are required in production — that is '
        + 'the account you sign in with, and there is no other way in.');
    }
    if (cfg.admin.password && cfg.admin.password.length < 12) {
      problems.push('ADMIN_PASSWORD is under 12 characters. This is the account that can '
        + 'read every student file.');
    }
    if (cfg.admin.password === DEV_PASSWORD) {
      problems.push('ADMIN_PASSWORD is the demo password from the README. It is published '
        + 'in this repository.');
    }
  }

  cfg.problems = problems;
  cfg.ok = problems.length === 0;
  return cfg;
}

/** Printed on start-up, so what mode it is in is never a guess. */
function describe(cfg) {
  if (!cfg.production) {
    return '  Mode: development — demo accounts on, cookies not marked Secure.\n'
         + '  Do not put this on a public address as it is: run it with GLOVELS_ENV=production.';
  }
  return `  Mode: PRODUCTION — no demo accounts, Secure cookies, sign-in throttled.\n`
       + `  Public address: ${cfg.siteUrl}`;
}

module.exports = { load, describe, DEV_PASSWORD };
