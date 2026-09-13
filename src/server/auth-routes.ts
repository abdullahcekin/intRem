import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import type { Auth, LoginSession } from './auth.js';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

export type Identity = Omit<LoginSession, 'token'>;
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, config: AppConfig, identity: (req: FastifyRequest) => Identity | null) {
  const cookie = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict' as const, path: '/' };
  const nameSchema = z.string().trim().min(1).max(80);
  const requireOwner = (req: FastifyRequest) => {
    const current = identity(req);
    if (!current) throw new AppError(401, 'LOGIN_REQUIRED', 'Oturum açmanız gerekiyor.');
    if (req.headers['x-csrf-token'] !== current.csrfToken) throw new AppError(403, 'CSRF', 'İstek doğrulanamadı. Sayfayı yenileyin.');
    return current;
  };
  app.get('/api/auth/status', async req => {
    const current = identity(req);
    return { authenticated: !!current, setupRequired: !auth.hasCredentials(), ...(current ?? {}) };
  });
  app.post('/api/auth/register/options', async (req, reply) => {
    const body = z.object({ bootstrapToken: z.string().max(256).optional(), name: nameSchema }).parse(req.body);
    const initial = !auth.hasCredentials();
    if (initial) { if (!auth.verifyBootstrap(body.bootstrapToken ?? '')) throw new AppError(403, 'BOOTSTRAP_INVALID', 'Kurulum kodu geçersiz. Sunucudaki kurulum dosyasını kontrol edin.'); }
    else requireOwner(req);
    const options = await generateRegistrationOptions({ rpName: 'intRem', rpID: config.rpId, userName: 'intrem-owner', userDisplayName: 'intRem sahibi', userID: new TextEncoder().encode(auth.ownerId), attestationType: 'none',
      excludeCredentials: auth.credentialIds().map(id => ({ id })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
    reply.setCookie('intrem_challenge', auth.createChallenge('registration', options.challenge, initial), { ...cookie, maxAge: 300 });
    return options;
  });
  app.post('/api/auth/register/verify', async (req, reply) => {
    const body = z.object({ response: z.record(z.string(), z.unknown()), name: nameSchema }).parse(req.body);
    const challenge = auth.consumeChallenge(req.cookies.intrem_challenge ?? '', 'registration');
    reply.clearCookie('intrem_challenge', cookie);
    if (!challenge.initial) requireOwner(req);
    let verification;
    try { verification = await verifyRegistrationResponse({ response: body.response as unknown as RegistrationResponseJSON, expectedChallenge: challenge.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true }); }
    catch { throw new AppError(400, 'PASSKEY_INVALID', 'Geçiş anahtarı doğrulanamadı. Yeniden deneyin.'); }
    if (!verification.verified || !verification.registrationInfo) throw new AppError(400, 'PASSKEY_INVALID', 'Geçiş anahtarı doğrulanamadı.');
    auth.saveCredential(verification.registrationInfo.credential, challenge.initial);
    const session = auth.issueSession(body.name, verification.registrationInfo.credential.id);
    reply.setCookie('intrem_session', session.token, { ...cookie, maxAge: 12 * 60 * 60 });
    return { authenticated: true, csrfToken: session.csrfToken, device: session.device };
  });
  app.post('/api/auth/login/options', async (_req, reply) => {
    if (!auth.hasCredentials()) throw new AppError(409, 'SETUP_REQUIRED', 'Önce sunucu kurulumunu tamamlayın.');
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required' });
    reply.setCookie('intrem_challenge', auth.createChallenge('login', options.challenge, false), { ...cookie, maxAge: 300 });
    return options;
  });
  app.post('/api/auth/login/verify', async (req, reply) => {
    const body = z.object({ response: z.record(z.string(), z.unknown()), name: nameSchema.optional() }).parse(req.body);
    const challenge = auth.consumeChallenge(req.cookies.intrem_challenge ?? '', 'login');
    reply.clearCookie('intrem_challenge', cookie);
    const credential = auth.getCredential(String(body.response.id ?? ''));
    if (!credential) throw new AppError(401, 'PASSKEY_INVALID', 'Geçiş anahtarı bulunamadı veya iptal edilmiş.');
    let verification;
    try { verification = await verifyAuthenticationResponse({ response: body.response as unknown as AuthenticationResponseJSON, expectedChallenge: challenge.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, credential, requireUserVerification: true }); }
    catch { throw new AppError(401, 'PASSKEY_INVALID', 'Giriş doğrulanamadı. Yeniden deneyin.'); }
    if (!verification.verified) throw new AppError(401, 'PASSKEY_INVALID', 'Giriş doğrulanamadı.');
    auth.updateCounter(credential.id, credential.counter, verification.authenticationInfo.newCounter);
    const session = auth.issueSession(body.name ?? 'Tarayıcı', credential.id);
    reply.setCookie('intrem_session', session.token, { ...cookie, maxAge: 12 * 60 * 60 });
    return { authenticated: true, csrfToken: session.csrfToken, device: session.device };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    requireOwner(req); auth.logout(req.cookies.intrem_session ?? ''); reply.clearCookie('intrem_session', cookie); return { ok: true };
  });
}
