import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../dist/server/app.js';
import { Store } from '../dist/server/store.js';
import { Auth } from '../dist/server/auth.js';
import { providerFailureText } from '../dist/runtime/provider-failure.js';

// Geçici veriler; canlı model çağrısı veya üretim girişini atlayan yol yoktur.
const dir = mkdtempSync(path.join(tmpdir(), 'intrem-browser-'));
const output = path.resolve('output/playwright');
mkdirSync(output, { recursive: true });
const origin = 'http://localhost:4111';
const config = { dataDir: dir, dbPath: path.join(dir, 'db.sqlite'), host: '127.0.0.1', port: 4111, origin, rpId: 'localhost', secureCookies: false, allowedRoots: [dir], claudeHome: path.join(dir, '.claude'), claudeExecutable: 'missing-claude', codexExecutable: 'missing-codex', omnirouteUrl: null, pushSubject: origin };
const projectTitle = 'Pilot uygulama · Uzun proje adlarıyla mobil okuma ve yazma kontrolü';
const sessionTitle = 'Mobil kontrol pilotu · Uzun oturum başlığıyla konuşma alanı ve taslak görünürlüğü';
const store = new Store(config.dbPath), auth = new Auth(store.db);
const bootstrap = auth.resetBootstrap();
const app = await createApp({ config, store, auth });
let browser;
const errors = [];
const waitFor = async (condition, label) => {
  const until = Date.now() + 12000;
  while (Date.now() < until) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Doğrulanamadı: ${label}`);
};
const assertConversationViewport = async (page, viewport) => {
  await page.setViewportSize(viewport);
  await page.waitForFunction(height => Math.abs(document.querySelector('.app-layout').getBoundingClientRect().height - height) <= 1, viewport.height);
  const composer = page.getByLabel('Bu oturuma mesaj', { exact: true });
  const send = page.getByRole('button', { name: 'Mesajı bu oturuma gönder' });
  const geometry = await page.locator('.conversation').evaluate(node => {
    const bounds = selector => {
      const element = node.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom } : null;
    };
    return { heading: bounds('.conversation-heading'), messages: bounds('.messages'), composer: bounds('textarea'), send: bounds('button[aria-label="Mesajı bu oturuma gönder"]') };
  });
  const minimumReadingHeight = viewport.height <= 400 ? 100 : 240;
  assert.ok(geometry.messages && geometry.messages.height >= minimumReadingHeight, `conversation reading area ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.heading && geometry.heading.height <= 112, `compact conversation header ${viewport.width}: ${JSON.stringify(geometry.heading)}`);
  assert.equal(await page.getByRole('navigation', { name: 'Mobil ana gezinme' }).isVisible(), false, 'mobile navigation yields space to the selected conversation');
  assert.equal(await page.locator('.topbar').isVisible(), false, 'app topbar yields space to the selected conversation');
  for (const [name, control] of [['composer', composer], ['send', send]]) {
    const rect = await control.boundingBox();
    assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, `${name} visible without scrolling ${viewport.width}x${viewport.height}: ${JSON.stringify(rect)}`);
    assert.equal(await control.evaluate(node => { const rect = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true, `${name} receives pointer input without overlay`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `conversation overflow ${viewport.width}`);
};
const assertConversationPanels = async page => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const sidebar = page.locator('.sidebar');
  const list = page.locator('.session-list');
  const conversation = page.locator('.conversation');
  const originalWidth = (await conversation.boundingBox()).width;
  for (const [hide, show, panel, other] of [
    ['Ana gezinmeyi gizle', 'Ana gezinmeyi göster', sidebar, list],
    ['Oturum listesini gizle', 'Oturum listesini göster', list, sidebar],
  ]) {
    await page.getByRole('button', { name: hide, exact: true }).click();
    assert.equal(await panel.isVisible(), false, hide);
    assert.equal(await other.isVisible(), true, 'other panel remains independently available');
    assert.ok((await conversation.boundingBox()).width > originalWidth + 150, `${hide} expands the reading area`);
    await page.getByRole('button', { name: show, exact: true }).click();
    assert.equal(await panel.isVisible(), true, show);
  }
  await page.getByRole('button', { name: 'Ana gezinmeyi gizle', exact: true }).click();
  const composer = page.getByLabel('Bu oturuma mesaj', { exact: true });
  await composer.fill('Odak değişse de bu taslak korunmalı.');
  await page.getByRole('button', { name: 'Odak modunu aç', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await list.isVisible(), false);
  assert.equal(await page.locator('.topbar').isVisible(), false);
  assert.equal(await composer.isVisible(), false, 'focus mode starts with only the conversation');
  assert.equal(await page.locator('.conversation-heading h2').isVisible(), false, 'focus mode hides session chrome');
  const focused = await conversation.boundingBox();
  assert.ok(focused && focused.x <= 1 && focused.y <= 1 && focused.width >= 1438 && focused.height >= 958, `focus mode uses the full viewport: ${JSON.stringify(focused)}`);
  await page.screenshot({ path: path.join(output, 'conversation-focus-desktop.png') });
  await page.getByRole('button', { name: 'Mesaj yaz', exact: true }).click();
  assert.equal(await composer.isVisible(), true, 'writing is available from focus mode');
  assert.equal(await composer.inputValue(), 'Odak değişse de bu taslak korunmalı.');
  await page.getByRole('button', { name: 'Mesaj alanını gizle', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'composer can be hidden again without leaving focus mode');
  await page.getByRole('button', { name: 'Odak modunu kapat', exact: true }).click();
  assert.equal(await sidebar.isVisible(), false, 'leaving focus mode preserves the collapsed navigation preference');
  assert.equal(await list.isVisible(), true, 'leaving focus mode restores the session list');
  assert.equal(await page.locator('.topbar').isVisible(), true);
  assert.equal(await composer.inputValue(), 'Odak değişse de bu taslak korunmalı.');
  await composer.fill('');
  await page.getByRole('button', { name: 'Ana gezinmeyi göster', exact: true }).click();
};
try {
  await app.listen({ host: config.host, port: config.port });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/info`);
  await page.getByRole('heading', { name: 'intRem kullanım rehberi', exact: true }).waitFor({ timeout: 5000 });
  assert.equal((await fetch(`${origin}/api/snapshot`)).status, 401, 'Public guide must not open protected data');
  await page.getByRole('link', { name: 'Sık sorulanlar', exact: true }).click();
  const faq = page.locator('summary').filter({ hasText: 'Başka bir cihazdan nasıl giriş yaparım?' });
  await faq.focus();
  await page.keyboard.press('Enter');
  assert.equal(await faq.evaluate(node => node.parentElement.open), true, 'FAQ opens with keyboard');
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 812, height: 375 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `guide overflow ${viewport.width}`);
    assert.equal(await page.locator('.info-toc a, .info-header a, summary').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), true, 'guide touch targets');
    await page.getByRole('link', { name: 'Uygulamayı aç', exact: true }).last().scrollIntoViewIfNeeded();
    const footer = await page.getByRole('link', { name: 'Uygulamayı aç', exact: true }).last().boundingBox();
    assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= viewport.height, 'guide footer reachable');
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'guide 200% reflow');
  await page.evaluate(() => { document.body.style.zoom = ''; });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => localStorage.setItem('intrem:theme', 'dark'));
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'info-mobile-dark.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => localStorage.setItem('intrem:theme', 'system'));
  await page.reload();
  await page.screenshot({ path: path.join(output, 'info-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: path.join(output, 'info-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Uygulamayı aç', exact: true }).first().click();
  await page.getByRole('heading', { name: 'İlk cihazınızı bağlayın' }).waitFor();
  await page.getByRole('link', { name: 'Kullanım rehberi', exact: true }).click();
  await page.getByRole('heading', { name: 'Kurulum anahtarı nedir?', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Uygulamayı aç', exact: true }).first().click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'İlk cihazınızı bağlayın' }).waitFor();
  await page.screenshot({ path: path.join(output, 'login-desktop.png') });
  await page.getByLabel('Kurulum anahtarı').fill(bootstrap);
  await page.getByRole('button', { name: 'Passkey oluştur ve bağlan' }).click();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  assert.equal(auth.hasCredentials(), true);
  await page.getByRole('link', { name: 'Kullanım rehberi', exact: true }).click();
  await page.getByRole('heading', { name: 'intRem kullanım rehberi', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Uygulamayı aç', exact: true }).first().click();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  await page.getByRole('button', { name: 'Proje ekle', exact: true }).first().click();
  await page.getByLabel('Proje adı', { exact: true }).fill(projectTitle);
  await page.getByLabel('Sunucudaki çalışma dizini').fill(dir);
  await page.getByRole('button', { name: 'Projeyi ekle', exact: true }).click();
  await waitFor(() => store.listProjects().length === 1, 'proje');
  await page.getByRole('button', { name: 'Yeni oturum başlat', exact: true }).first().click();
  await page.getByLabel('Oturum adı', { exact: false }).fill(sessionTitle);
  await page.getByRole('button', { name: 'Oturumu oluştur' }).click();
  await waitFor(() => store.listSessions().length === 1, 'oturum');
  const session = store.listSessions()[0];
  await page.getByRole('button', { name: 'Oturum bilgisi', exact: true }).click();
  const costInfo = page.getByText('Son SDK maliyet tahmini', { exact: true }).locator('..');
  await costInfo.getByText('Bilinmiyor', { exact: true }).waitFor({ timeout: 5000 });
  await costInfo.getByText('Henüz sonuç ölçümü yok.', { exact: true }).waitFor();
  store.recordSessionCost(session.id, session.generation, 0);
  await costInfo.getByText('0,00 USD', { exact: true }).waitFor();
  store.recordSessionCost(session.id, session.generation, 1.234567);
  await costInfo.getByText('1,234567 USD', { exact: true }).waitFor();
  const costObservedAt = store.getSession(session.id).costEstimate.observedAt;
  assert.equal(await costInfo.locator('time').getAttribute('datetime'), costObservedAt);
  await costInfo.getByText(/Toplam fatura veya bütçe sınırı değildir/).waitFor();
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await costInfo.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `cost estimate overflow ${width}`);
    const costBounds = await costInfo.boundingBox();
    assert.ok(costBounds && costBounds.y >= 0 && costBounds.y + costBounds.height <= 812, `cost estimate reachable ${width}`);
    await page.screenshot({ path: path.join(output, `cost-estimate-${width}.png`) });
  }
  await page.reload();
  await page.getByRole('button', { name: 'Oturum bilgisi', exact: true }).click();
  await costInfo.getByText('1,234567 USD', { exact: true }).waitFor();
  assert.equal(await costInfo.locator('time').getAttribute('datetime'), costObservedAt, 'reload preserves the cost observation');
  store.recordSessionCost(session.id, session.generation, 0.000000001);
  await costInfo.getByText('< 0,000001 USD', { exact: true }).waitFor();
  assert.equal(await costInfo.getByText('0,00 USD', { exact: true }).count(), 0, 'a positive estimate never rounds to zero');
  store.recordSessionCost(session.id, session.generation, null);
  await costInfo.getByText('Bilinmiyor', { exact: true }).waitFor();
  assert.equal(await costInfo.locator('time').getAttribute('datetime'), store.getSession(session.id).costEstimate.observedAt);
  assert.equal(await costInfo.getByText('Henüz sonuç ölçümü yok.', { exact: true }).count(), 0, 'unusable result still has an observation time');
  await page.getByRole('dialog', { name: 'Oturum bilgisi', exact: true }).getByRole('button', { name: 'Pencereyi kapat', exact: true }).click();
  for (const viewport of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await assertConversationViewport(page, viewport);
    await page.screenshot({ path: path.join(output, `conversation-readable-${viewport.width}.png`) });
  }
  await assertConversationPanels(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  const sentIds = [];
  let drop = true;
  await page.route('**/api/sessions/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    sentIds.push(route.request().postDataJSON().clientId);
    if (drop) { drop = false; return route.abort('failed'); }
    return route.continue();
  });
  await page.getByLabel('Bu oturuma mesaj', { exact: true }).fill('Belirsiz HTTP gönderim testi');
  await page.getByRole('button', { name: 'Mesajı bu oturuma gönder' }).click();
  await page.getByRole('button', { name: 'Aynı kimlikle yeniden dene' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Aynı kimlikle yeniden dene' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mesajı bu oturuma gönder' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Aynı kimlikle yeniden dene' }).click();
  await waitFor(() => store.listMessages(session.id).some(m => m.role === 'user'), 'aynı kimlikle gönderim');
  assert.equal(sentIds.length, 2); assert.equal(sentIds[0], sentIds[1]);
  assert.equal(store.listMessages(session.id).filter(m => m.role === 'user').length, 1);
  store.cancelMessage(store.listMessages(session.id).find(m => m.role === 'user').id);
  const failedMessage = store.listMessages(session.id).find(m => m.role === 'user');
  const failureText = providerFailureText('success', 'rate_limit', { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1789459200 });
  store.updateMessage(failedMessage.id, { state: 'failed', error: failureText });
  await page.getByText(failureText, { exact: true }).waitFor();
  await page.reload();
  const diagnostic = page.getByText(failureText, { exact: true });
  await diagnostic.waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await diagnostic.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'provider failure mobile overflow');
  assert.equal(store.listMessages(session.id).filter(m => m.role === 'user').length, 1, 'failure reload does not resend');
  assert.equal(store.listMessages(session.id)[0].state, 'failed');
  await page.screenshot({ path: path.join(output, 'provider-failure-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 960 });
  store.updateMessage(failedMessage.id, { state: 'cancelled', error: null });
  store.setSetting('runnerHeartbeat', new Date().toISOString());
  await page.getByRole('button', { name: 'Oturum bilgisi', exact: true }).click();
  await page.getByRole('button', { name: 'Codex ile incele' }).click();
  const reviewDialog = page.getByRole('dialog', { name: 'Codex incelemesini başlat', exact: true });
  await reviewDialog.waitFor();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await reviewDialog.evaluate(node => node.contains(document.activeElement)), true, 'review dialog keeps keyboard focus above session details');
  }
  await page.keyboard.press('Escape');
  await reviewDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog', { name: 'Oturum bilgisi', exact: true }).isVisible(), true, 'closing a child dialog leaves session details open');
  assert.equal(await page.getByRole('button', { name: 'Codex ile incele' }).evaluate(node => node === document.activeElement), true, 'review dialog restores its trigger focus');
  await page.getByRole('button', { name: 'Codex ile incele' }).click();
  await page.getByRole('button', { name: 'İncelemeyi başlat', exact: true }).click();
  await waitFor(() => store.listReviews(session.id).length === 1, 'Codex inceleme isteği');
  await page.getByRole('dialog', { name: 'Codex incelemesini başlat', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: 'Oturum bilgisi', exact: true }).getByRole('button', { name: 'Pencereyi kapat', exact: true }).click();
  store.updateReview(store.listReviews(session.id)[0].id, 'completed', 'Tarayıcı test verisi: inceleme çıktısı.', 'test-revision', 0);
  store.appendMessage(session.id, 'assistant', 'Proje hazır. Sonraki adım için tercihinizi bekliyorum.');
  const interaction = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'browser-fixture-question', kind: 'question', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Hangi ortamda devam edelim?', options: [{ label: 'Pilot', description: 'Yalıtılmış deneme ortamı' }, { label: 'Geliştirme', description: 'Yerel geliştirme ortamı' }] }] }, expiresAt: new Date(Date.now() + 600000).toISOString() });
  store.updateSession(session.id, { state: 'waiting_answer' });
  await page.getByText('Proje hazır.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(output, 'sessions-desktop.png') });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `yatay taşma ${width}`);
  }
  for (const viewport of [{ width: 812, height: 375 }, { width: 390, height: 400 }]) {
    await assertConversationViewport(page, viewport);
    await page.screenshot({ path: path.join(output, `conversation-short-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'conversation-mobile.png') });
  await assertConversationViewport(page, { width: 390, height: 844 });
  const answerButton = page.getByRole('button', { name: 'İncele', exact: true });
  await answerButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Claude cevabınızı bekliyor' }).waitFor();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true, 'odak karar penceresinde kalır');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Claude cevabınızı bekliyor' }).waitFor({ state: 'hidden' });
  assert.equal(await answerButton.evaluate(node => node === document.activeElement), true, 'odak karar düğmesine geri döner');
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: /Pilot/ }).focus();
  await page.keyboard.press('Space');
  await page.screenshot({ path: path.join(output, 'question-mobile.png') });
  await page.getByRole('button', { name: 'Yanıtı gönder', exact: true }).focus();
  await page.keyboard.press('Enter');
  await waitFor(() => store.getInteraction(interaction.id).status === 'answered', 'soru yanıtı');
  assert.equal(store.getInteraction(interaction.id).decision.answers['Hangi ortamda devam edelim?'], 'Pilot');
  const planText = '# Pilot planı\n\n1. Yalnız test sonucunu raporla.';
  const plan = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'browser-fixture-plan', kind: 'plan', toolName: 'ExitPlanMode', input: { plan: planText }, expiresAt: new Date(Date.now() + 600000).toISOString() });
  store.updateSession(session.id, { state: 'permission_required' });
  await answerButton.click();
  await page.getByRole('dialog', { name: 'Plan kararı' }).waitFor();
  assert.equal(await page.locator('.tool-preview').textContent(), planText, 'plan metni aynen gösterilir');
  const approvePlan = page.getByRole('button', { name: 'Bir kez onayla', exact: true });
  assert.equal(await approvePlan.isDisabled(), true, 'plan incelendi onayı gereklidir');
  await page.getByRole('checkbox', { name: /Gösterilen plan sürümünü inceledim/ }).check();
  await approvePlan.click();
  await waitFor(() => store.getInteraction(plan.id).status === 'answered', 'plan onayı');
  assert.equal(store.getInteraction(plan.id).decision.behavior, 'allow');
  assert.equal(store.getInteraction(plan.id).contentHash, plan.contentHash);
  assert.equal(store.getInteraction(plan.id).appliedAt, null, 'UI kararı runner uygulaması sayılmaz');
  const missingPlan = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'browser-fixture-missing-plan', kind: 'plan', toolName: 'ExitPlanMode', input: {}, expiresAt: new Date(Date.now() + 600000).toISOString() });
  await answerButton.click();
  await page.getByText('Bu istekte plan metni bulunmuyor.', { exact: false }).waitFor();
  await page.getByRole('checkbox', { name: /Gösterilen plan sürümünü inceledim/ }).check();
  assert.equal(await approvePlan.isDisabled(), true, 'eksik plan onaylanamaz');
  await page.keyboard.press('Escape');
  store.cancelInteraction(missingPlan.id, session.generation);
  const imported = store.createSession({ projectId: session.projectId, source: 'imported', title: `${sessionTitle} · İçe aktarılan kaynak oturum`, claudeSessionId: '00000000-0000-4000-8000-000000000123' });
  const longToken = 'uzun-kesintisiz-mesaj-ve-kod-parçası'.repeat(24);
  const importedText = `İçe aktarılmış konuşmanın okunabilirlik kontrolü.\n\nProjenin son değişikliklerini inceledim. Konuşma alanı artık ekranın kalan yüksekliğini kullanıyor; mesaj yazarken önceki yanıtları kaydırarak okuyabilirsiniz.\n\nTamamlanan işler\n• Dar ekranda başlık sadeleştirildi.\n• Yazı alanı ve gönder düğmesi görünür tutuldu.\n• Oturum değiştirmeden odak görünümüne geçilebiliyor.\n\nUzun satır kontrolü:\n${longToken}\n\n\`\`\`typescript\nconst output = '${longToken}';\n\`\`\``;
  store.appendMessage(imported.id, 'assistant', importedText);
  await page.goto(`${origin}/?session=${imported.id}`);
  await page.getByText('İçe aktarılmış konuşmanın okunabilirlik kontrolü.', { exact: false }).waitFor();
  for (const viewport of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await assertConversationViewport(page, viewport);
    assert.equal(await page.getByRole('button', { name: 'Mesajı bu oturuma gönder' }).isDisabled(), true, 'an imported source remains read-only');
    assert.equal(await page.locator('.messages').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'long text and code stay inside the conversation');
    assert.ok((await page.getByRole('button', { name: 'Kontrollü devral', exact: true }).boundingBox())?.height >= 44, 'read-only takeover touch target remains available');
    await page.locator('.messages').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, `conversation-imported-${viewport.width}.png`) });
  }
  const importedDraft = page.getByLabel('Bu oturuma mesaj', { exact: true });
  await importedDraft.fill('Kaynak oturum devredilene kadar saklanacak mobil taslak.');
  await assertConversationViewport(page, { width: 375, height: 400 });
  assert.equal(await importedDraft.evaluate(node => node === document.activeElement), true, 'shrinking the viewport preserves writing focus');
  assert.equal(await importedDraft.inputValue(), 'Kaynak oturum devredilene kadar saklanacak mobil taslak.');
  await page.screenshot({ path: path.join(output, 'conversation-keyboard-375.png') });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport, { height: { configurable: true, get: () => 400 }, offsetTop: { configurable: true, get: () => 80 } });
    window.visualViewport.dispatchEvent(new Event('resize'));
    window.visualViewport.dispatchEvent(new Event('scroll'));
  });
  const keyboardBox = await page.locator('.app-layout').boundingBox();
  assert.ok(keyboardBox && keyboardBox.y === 80 && keyboardBox.height === 400, 'visual viewport resize and pan work while the layout viewport stays tall');
  const visualSend = await page.getByRole('button', { name: 'Mesajı bu oturuma gönder' }).boundingBox();
  assert.ok(visualSend && visualSend.y >= 80 && visualSend.y + visualSend.height <= 480, 'send stays inside the keyboard-reduced visual viewport');
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await assertConversationViewport(page, { width: 375, height: 400 });
  await page.getByRole('button', { name: 'Odak modunu aç', exact: true }).click();
  assert.equal(await importedDraft.isVisible(), false, 'mobile focus mode also hides the composer');
  assert.equal(await page.getByRole('button', { name: 'Oturum listesine dön', exact: true }).isVisible(), false, 'focus mode hides the back navigation too');
  const mobileReading = await page.locator('.messages').boundingBox();
  assert.ok(mobileReading && mobileReading.height >= 320, 'mobile focus mode dedicates the viewport to reading');
  await page.screenshot({ path: path.join(output, 'conversation-focus-mobile.png') });
  await page.getByRole('button', { name: 'Mesaj yaz', exact: true }).click();
  assert.equal(await importedDraft.inputValue(), 'Kaynak oturum devredilene kadar saklanacak mobil taslak.');
  const focusedSend = await page.getByRole('button', { name: 'Mesajı bu oturuma gönder' }).boundingBox();
  assert.ok(focusedSend && focusedSend.y + focusedSend.height <= 400, 'focus composer stays above the shrunken viewport edge');
  await page.getByRole('button', { name: 'Odak modunu kapat', exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await assertConversationViewport(page, { width: 375, height: 667 });
  await page.locator('.messages').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'conversation-dark-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Odak modunu aç', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'conversation-dark-focus-desktop.png') });
  await page.getByRole('button', { name: 'Odak modunu kapat', exact: true }).click();
  await page.reload();
  await importedDraft.waitFor();
  assert.equal(await importedDraft.inputValue(), 'Kaynak oturum devredilene kadar saklanacak mobil taslak.', 'read-only draft survives reload');
  assert.equal(store.listMessages(imported.id).length, 1, 'reading and writing a draft never submit to the source');
  assert.equal(store.getSession(imported.id).controlEnabled, false, 'UI layout actions never take control of the source');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Oturum listesine dön', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'Mobil ana gezinme' }).isVisible(), true, 'returning to the list restores mobile navigation');
  assert.equal(await page.locator('.topbar').isVisible(), true, 'returning to the list restores the app header');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).last().click();
  await page.getByLabel('Proje bildirimleri').focus();
  await page.keyboard.press('Space');
  await waitFor(() => store.listProjects()[0].pushEnabled, 'proje bildirimi');
  await page.getByRole('heading', { name: 'Proje profilleri' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'settings-mobile.png') });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker denetimi');
  const cachePaths = await page.evaluate(async () => {
    const cachesForApp = (await caches.keys()).filter(key => key.startsWith('intrem-shell-'));
    return (await Promise.all(cachesForApp.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
  });
  assert.ok(cachePaths.includes('/') && cachePaths.some(p => p.startsWith('/assets/')), 'shell and built assets cached');
  assert.equal(cachePaths.some(p => p.startsWith('/api') || p === '/health'), false, 'private APIs and health never cached');
  const messagesBeforeOffline = store.listMessages(session.id).length;
  await context.setOffline(true);
  await waitFor(async () => (await page.getByText('Çevrimdışı', { exact: false }).count()) > 0, 'çevrimdışı');
  assert.equal(await page.getByLabel('Proje bildirimleri').isDisabled(), true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(/Çevrimdışısınız\.|Sunucuya ulaşılamadı\./).waitFor({ timeout: 5000 });
  await page.getByRole('link', { name: 'Kullanım rehberi', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'offline-reload-mobile.png') });
  assert.equal(await page.getByText(projectTitle, { exact: true }).count(), 0, 'private snapshot is not served from the shell cache');
  assert.equal(await page.getByLabel('Kurulum anahtarı').count(), 0, 'offline reload does not claim initial setup is needed');
  assert.equal(await page.evaluate(async () => {
    try { await fetch('/api/snapshot'); return true; } catch { return false; }
  }), false, 'snapshot does not fall back to cached data');
  await context.setOffline(false);
  const retryConnection = page.getByRole('button', { name: 'Yeniden dene', exact: true });
  if (await retryConnection.isVisible()) {
    await retryConnection.click({ timeout: 1500 }).catch(async error => {
      if (!(await page.getByRole('navigation', { name: 'Ana gezinme' }).isVisible())) throw error;
    });
  }
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  assert.equal(store.listMessages(session.id).length, messagesBeforeOffline, 'reconnect does not submit a message');
  await context.setOffline(true);
  await page.goto(`${origin}/info`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'intRem kullanım rehberi', exact: true }).waitFor();
  await context.setOffline(false);
  await page.goto(origin);
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  let gatewaySetup = {
    checkedAt: '2026-09-14T08:00:00.000Z',
    connections: { state: 'auth_required', count: null },
    pools: { state: 'unavailable', count: null },
    mappings: { state: 'auth_required', count: null },
  };
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    const health = await response.json();
    await route.fulfill({ json: { ...health, omniroute: { ...health.omniroute, setup: gatewaySetup } } });
  });
  await page.getByRole('button', { name: 'Sistem', exact: true }).last().click();
  const setup = page.getByRole('region', { name: 'OmniRoute kurulumu', exact: true });
  await setup.getByText('Yetki gerekiyor', { exact: true }).first().waitFor({ timeout: 5000 });
  assert.equal(await setup.getByText('Yetki gerekiyor', { exact: true }).count(), 2);
  assert.equal(await setup.getByText('Bilinmiyor', { exact: true }).count(), 1);
  assert.equal(await setup.getByText('0', { exact: true }).count(), 0, 'unknown gateway state is not zero');
  await setup.getByText(/Son kontrol:/).waitFor();
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await setup.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `gateway setup overflow ${width}`);
    await page.screenshot({ path: path.join(output, `gateway-setup-${width}.png`) });
  }
  gatewaySetup = { ...gatewaySetup, connections: { state: 'ok', count: 3 }, pools: { state: 'ok', count: 0 }, mappings: { state: 'ok', count: 2 } };
  await page.getByRole('button', { name: 'Yenile', exact: true }).click();
  await setup.getByText('3', { exact: true }).waitFor();
  await setup.getByText('0', { exact: true }).waitFor();
  await setup.getByText('2', { exact: true }).waitFor();
  await setup.getByText(/Henüz havuz kaydı yok/).waitFor();
  await setup.getByText(/hangi hesabın veya modelin kullanıldığını doğrulamaz/).waitFor();
  await page.unroute('**/api/health');
  const cookies = await context.cookies();
  const identity = auth.authenticate(cookies.find(c => c.name === 'intrem_session').value);
  assert.ok(identity);
  const cursor = store.cursor();
  const abort = new AbortController();
  const stream = await fetch(`${origin}/api/events/stream?after=0`, { headers: { cookie: `intrem_session=${cookies.find(c => c.name === 'intrem_session').value}`, 'Last-Event-ID': String(cursor) }, signal: abort.signal });
  const reader = stream.body.getReader();
  let received = new TextDecoder().decode((await reader.read()).value);
  store.event('test.replay', null, { checked: true });
  received += new TextDecoder().decode((await reader.read()).value);
  assert.ok(received.includes('test.replay'));
  assert.equal(received.includes('project.created'), false);
  auth.revokeDevice(identity.device.id);
  let ended = false;
  await waitFor(async () => { const item = await reader.read(); ended = item.done; return ended; }, 'SSE iptali');
  abort.abort();
  await waitFor(async () => (await page.getByRole('heading', { name: /Çalışmanıza bağlanın|İlk cihazınızı bağlayın/ }).count()) > 0, 'cihaz iptali');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['passkey-register', 'project-session-ui', 'question-answer', 'plan-content-confirmation', 'missing-plan-denied', 'keyboard-dialog-focus-return', 'keyboard-question-and-settings', 'mobile-send-visible', 'project-push-preference', 'responsive-320-1440', 'offline-disable', 'SSE-replay-cursor', 'device-revoke-SSE', 'unknown-delivery-reload-idempotency', 'review-request-ui', 'public-guide-and-auth-return', 'guide-keyboard-and-touch', 'guide-responsive-theme-zoom', 'short-viewport-composer', 'provider-failure-mobile-reload', 'gateway-setup-mobile-counts-and-access', 'PWA-offline-reload-and-cache-boundary', 'cost-estimate-states-mobile-reload', 'independent-desktop-panels', 'focus-reader-and-draft-toggle', 'compact-header-reading-area', 'imported-readonly-mobile-keyboard', 'long-title-text-and-code-containment'], screenshots: output }));
} finally {
  await browser?.close();
  await app.close(); store.close();
  rmSync(dir, { recursive: true, force: true });
}
