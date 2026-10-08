// HTML for Prism's Account Link page, where Ring sends the user after they
// approve Prism in the Ring app. Ring requires the user to sign in here
// before the link completes; Prism has no user accounts, so the household
// signs in with its link passcode (RING_LINK_PASSCODE).

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Prism</title>
<style>
  body { font-family: system-ui, sans-serif; background: #080b11; color: #e8ecf4; margin: 0; padding: 2rem 1rem; line-height: 1.5; }
  main { max-width: 28rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; }
  label { display: block; font-weight: 600; margin: 1.25rem 0 0.4rem; }
  input { font: inherit; width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border-radius: 0.5rem; border: 1px solid #8a94a8; background: #121826; color: inherit; }
  button { font: inherit; font-weight: 600; margin-top: 1rem; padding: 0.6rem 1.25rem; border-radius: 0.5rem; border: none; background: #a8b4ff; color: #080b11; cursor: pointer; }
  input:focus-visible, button:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
  .error { color: #ffb4a8; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function signInPage(nonce: string, time: string, error?: string): string {
  return page(
    "Link your Ring account",
    `<h1>Link your Ring account to Prism</h1>
<p>Enter your household's Prism link passcode to finish connecting your Ring doorbell and cameras.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/ring/link">
  <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
  <input type="hidden" name="time" value="${escapeHtml(time)}">
  <label for="passcode">Link passcode</label>
  <input id="passcode" name="passcode" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Link Ring account</button>
</form>`,
  );
}

export function messagePage(title: string, message: string, isError = false): string {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p${isError ? ' class="error" role="alert"' : ""}>${escapeHtml(message)}</p>`,
  );
}
