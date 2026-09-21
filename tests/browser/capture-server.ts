import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 3201;

const agentPage = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vision Capture Fixture</title>
  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: #f6f7f9;
      color: #111827;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(1120px, calc(100% - 64px));
      margin: 0 auto;
      padding: 72px 0;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 48px;
      line-height: 1.05;
      letter-spacing: -0.04em;
    }

    .subtitle {
      margin: 0 0 40px;
      color: #6b7280;
      font-size: 18px;
    }

    .composer {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 14px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      box-shadow: 0 14px 40px rgba(15, 23, 42, 0.08);
    }

    textarea {
      min-height: 92px;
      resize: none;
      border: 0;
      outline: none;
      padding: 14px;
      font: inherit;
      font-size: 17px;
      background: transparent;
    }

    button {
      align-self: end;
      border: 0;
      border-radius: 12px;
      padding: 14px 20px;
      background: #111827;
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .state {
      margin-top: 28px;
    }

    .running {
      padding: 22px;
      border-radius: 16px;
      background: #fff;
      border: 1px solid #e5e7eb;
    }

    .results {
      display: grid;
      gap: 12px;
    }

    .result {
      padding: 22px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
    }

    .result strong {
      display: block;
      margin-bottom: 6px;
      font-size: 18px;
    }

    [hidden] {
      display: none !important;
    }
  </style>
</head>
<body>
  <main>
    <h1>Agent Vision</h1>
    <p class="subtitle">Fixture locale déterministe — aucun fournisseur externe.</p>

    <section class="composer">
      <textarea
        data-testid="agent-composer"
        aria-label="Demande de prospection"
        placeholder="Décris les entreprises que tu recherches"
      ></textarea>

      <button data-testid="agent-submit" type="button">
        Rechercher
      </button>
    </section>

    <section class="state">
      <div data-testid="mission-running" class="running" hidden>
        Vision recherche et qualifie les entreprises…
      </div>

      <div data-testid="mission-results" class="results" hidden>
        <article class="result">
          <strong>Atelier Horizon</strong>
          <span>Entreprise qualifiée · Lyon</span>
        </article>

        <article class="result">
          <strong>Maison Rivage</strong>
          <span>Entreprise qualifiée · Lyon</span>
        </article>

        <article class="result">
          <strong>Studio Atlas</strong>
          <span>Entreprise qualifiée · Lyon</span>
        </article>
      </div>
    </section>
  </main>

  <script>
    const composer = document.querySelector('[data-testid="agent-composer"]');
    const submit = document.querySelector('[data-testid="agent-submit"]');
    const running = document.querySelector('[data-testid="mission-running"]');
    const results = document.querySelector('[data-testid="mission-results"]');

    submit.addEventListener('click', () => {
      if (!composer.value.trim()) return;

      submit.disabled = true;
      results.hidden = true;
      running.hidden = false;

      window.setTimeout(() => {
        running.hidden = true;
        results.hidden = false;
        submit.disabled = false;
      }, 120);
    });
  </script>
</body>
</html>`;

const isolationPage = `<!doctype html>
<html lang="fr">
<body>
  <div data-testid="isolation-state"></div>

  <script>
    const dirty =
      document.cookie.includes('vce-isolation=1') ||
      localStorage.getItem('vce-isolation') === '1' ||
      sessionStorage.getItem('vce-isolation') === '1';

    document.querySelector('[data-testid="isolation-state"]').textContent =
      dirty ? 'dirty' : 'clean';

    document.cookie = 'vce-isolation=1; Path=/; SameSite=Lax';
    localStorage.setItem('vce-isolation', '1');
    sessionStorage.setItem('vce-isolation', '1');
  </script>
</body>
</html>`;

const authStatePage = `<!doctype html>
<html lang="fr">
<body>
  <div data-testid="auth-state"></div>

  <script>
    const cookieReady = document.cookie.includes('vce-auth=ready');
    const localReady = localStorage.getItem('vce-auth') === 'ready';

    document.querySelector('[data-testid="auth-state"]').textContent =
      cookieReady && localReady ? 'ready' : 'missing';
  </script>
</body>
</html>`;

const popupPage = `<!doctype html>
<html lang="fr">
<body>
  <button data-testid="open-popup" type="button">
    Ouvrir
  </button>

  <script>
    document
      .querySelector('[data-testid="open-popup"]')
      .addEventListener('click', () => {
        window.open('/popup-target', '_blank');
      });
  </script>
</body>
</html>`;

const downloadPage = `<!doctype html>
<html lang="fr">
<body>
  <a data-testid="start-download" href="/download-file" download="fixture.txt">
    Télécharger
  </a>
</body>
</html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'GET' && url.pathname === '/healthz') {
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('ok');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/agent') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(agentPage);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/isolation') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(isolationPage);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/auth-state') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(authStatePage);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/popup') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(popupPage);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/popup-target') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end('<!doctype html><title>Popup target</title>');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/download') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(downloadPage);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/download-file') {
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fixture.txt"',
    });
    response.end('fixture-download');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/redirect-blocked') {
    response.writeHead(302, {
      Location: 'http:' + '//localhost:3201/agent',
    });
    response.end();
    return;
  }

  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('not found');
});

let closing = false;

function close() {
  if (closing) return;
  closing = true;

  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGTERM', close);
process.once('SIGINT', close);

server.listen(port, host);
