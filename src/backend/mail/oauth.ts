// OAuth2 (authorization code + PKCE, loopback redirect) for Microsoft 365 / Outlook.com and Google.

import crypto from 'node:crypto';
import http from 'node:http';
import type { OAuthProvider, Settings } from '@shared/types';
import { escapeHtml } from '@shared/util';
import { platform } from '../platform';

interface ProviderConf {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret?: string;
  host: string;
  extra: Record<string, string>;
}

function conf(provider: OAuthProvider, s: Settings): ProviderConf {
  if (provider === 'microsoft') {
    const tenant = s.oauth.microsoftTenant || 'common';
    return {
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scope: 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email',
      clientId: s.oauth.microsoftClientId,
      clientSecret: s.oauth.microsoftClientSecret || undefined,
      host: 'localhost',
      extra: { prompt: 'select_account' }
    };
  }
  return {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://mail.google.com/ openid email',
    clientId: s.oauth.googleClientId,
    clientSecret: s.oauth.googleClientSecret || undefined,
    host: '127.0.0.1',
    extra: { access_type: 'offline', prompt: 'consent' }
  };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(c: ProviderConf, body: Record<string, string>): Promise<TokenResponse> {
  const params = new URLSearchParams({ client_id: c.clientId, ...body });
  if (c.clientSecret) params.set('client_secret', c.clientSecret);
  const res = await fetch(c.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    const desc = json.error_description ?? json.error ?? res.statusText;
    // Azure app registered as "Web" (confidential client) instead of "Mobile and desktop applications"
    if (/AADSTS7000218|AADSTS700025/.test(desc)) {
      throw new Error(
        'Microsoft verlangt ein Client-Secret, weil die App in Azure als Web-App registriert ist. Lösung: Azure-Portal → App-Registrierungen → Authentifizierung → ' +
          'Umleitungs-URI http://localhost unter „Mobile- und Desktopanwendungen“ eintragen und „Öffentliche Clientflows zulassen“ auf „Ja“ stellen. ' +
          'Alternativ ein Client-Secret erstellen und unter Einstellungen → Konten → OAuth eintragen.'
      );
    }
    if (/AADSTS50011/.test(desc)) {
      throw new Error('Die Umleitungs-URI passt nicht: in Azure unter „Mobile- und Desktopanwendungen“ die URI http://localhost eintragen.');
    }
    throw new Error(`OAuth-Fehler: ${desc}`);
  }
  return json;
}

/** Runs the interactive login; resolves with the refresh token */
export async function oauthLogin(provider: OAuthProvider, email: string, settings: Settings): Promise<{ refreshToken: string; accessToken: string; expires: number }> {
  const c = conf(provider, settings);
  if (!c.clientId) {
    throw new Error(
      provider === 'microsoft'
        ? 'Für Microsoft-Konten wird eine Client-ID benötigt (Einstellungen → Konten → OAuth). Alternativ ein App-Kennwort verwenden.'
        : 'Für Google-Konten werden Client-ID und Client-Secret benötigt (Einstellungen → Konten → OAuth). Alternativ ein App-Passwort verwenden.'
    );
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, c.host, resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://${c.host}:${port}`;

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Anmeldung abgebrochen (Zeitüberschreitung).')), 5 * 60 * 1000);
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      // ignore stray requests (favicon, probes) that do not belong to this login
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end();
        return;
      }
      const ok = !err && url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>KS Mail</title><body style="font-family:system-ui;padding:40px;text-align:center">` +
          (ok ? '<h2>Anmeldung erfolgreich</h2><p>Sie können dieses Fenster schließen und zu KS Mail zurückkehren.</p>' : `<h2>Anmeldung fehlgeschlagen</h2><p>${escapeHtml(err ?? 'Ungültige Antwort')}</p>`) +
          '</body>'
      );
      clearTimeout(timer);
      if (ok) resolve(url.searchParams.get('code')!);
      else reject(new Error(`Anmeldung fehlgeschlagen: ${url.searchParams.get('error_description') ?? err ?? 'ungültige Antwort'}`));
    });
    const auth = new URL(c.authUrl);
    const q: Record<string, string> = {
      client_id: c.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: c.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      login_hint: email,
      ...c.extra
    };
    for (const [k, v] of Object.entries(q)) auth.searchParams.set(k, v);
    void platform().openExternal(auth.toString());
  }).finally(() => server.close());

  const tok = await tokenRequest(c, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  if (!tok.refresh_token) throw new Error('Der Anbieter hat kein Refresh-Token geliefert.');
  return { refreshToken: tok.refresh_token, accessToken: tok.access_token, expires: Date.now() + tok.expires_in * 1000 };
}

const cache = new Map<string, { token: string; expires: number }>();

/** Returns a valid access token, refreshing it when necessary. `onRotate` receives a new refresh token. */
export async function accessToken(
  accountId: string,
  provider: OAuthProvider,
  refreshToken: string,
  settings: Settings,
  onRotate: (rt: string) => void
): Promise<string> {
  const hit = cache.get(accountId);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const c = conf(provider, settings);
  const tok = await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: c.scope });
  cache.set(accountId, { token: tok.access_token, expires: Date.now() + tok.expires_in * 1000 });
  if (tok.refresh_token && tok.refresh_token !== refreshToken) onRotate(tok.refresh_token);
  return tok.access_token;
}

export function primeToken(accountId: string, token: string, expires: number): void {
  cache.set(accountId, { token, expires });
}

export function forgetToken(accountId: string): void {
  cache.delete(accountId);
}
