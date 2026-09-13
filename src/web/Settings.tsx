import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Bell, Check, Download, Fingerprint, Globe, Laptop, Link, Moon, Plus, RefreshCw, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import type { Device, HealthReport, Project, Session } from '../shared/types';
import { Button, Modal, Notice } from './App';
import { api, errorText } from './api';
import { displayTime, notificationSupport } from './helpers';

export function HealthPanel({ online, stream, sessions }: { online: boolean; stream: boolean; sessions: Session[] }) {
  const [health, setHealth] = useState<HealthReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setBusy(true); try { setHealth(await api('/health')); setError(''); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000); return () => clearInterval(timer); }, [refresh]);
  return <section className="settings-page"><div className="page-heading"><div><p className="eyebrow">BAĞLANTI VE ÇALIŞMA DURUMU</p><h1>Sistem sağlığı</h1><p className="muted">Bu ekran yeni model çağrısı başlatmadan durumu gösterir.</p></div><Button onClick={() => void refresh()} disabled={!online} busy={busy}><RefreshCw size={18} />Yenile</Button></div>{error && <Notice tone="error">{error}</Notice>}
    <div className="health-grid">{[
      { title: 'Tarayıcı bağlantısı', ok: online, detail: stream ? 'Canlı olay akışına bağlı' : 'Canlı akış bağlı değil; periyodik güncelleme kullanılıyor' },
      { title: 'Remote Bridge', ok: health?.bridge.ok, detail: health ? `intRem ${health.bridge.version}` : 'Kontrol ediliyor' },
      { title: 'Oturum çalıştırıcısı', ok: health?.runner.ok, detail: `Son bağlantı: ${displayTime(health?.runner.lastSeenAt)}` },
      { title: 'Claude Code', ok: health?.claude.ok, detail: health?.claude.version ?? 'Çalıştırılabilir dosya doğrulanamadı' },
      { title: 'Codex inceleme aracı', ok: health?.codex.ok, detail: health?.codex.version ?? 'Araç doğrulanamadı; bu durum tamamlanmış review anlamına gelmez' },
      { title: 'OmniRoute', ok: health?.omniroute.ok, detail: health?.omniroute.detail ?? 'Kontrol ediliyor' },
    ].map(item => <article className="health-card" key={item.title}><div className="health-card-heading"><h2>{item.title}</h2><span className={`status-dot ${item.ok ? 'ok' : 'warning'}`} /></div><strong>{item.ok === undefined ? 'Kontrol ediliyor' : item.ok ? 'Erişilebilir' : 'Kontrol gerekiyor'}</strong><p className="muted">{item.detail}</p></article>)}</div>
    <section className="settings-card"><h2>Görev ilerlemesi</h2><p className="muted">Bağlantının açık olması işin ilerlediğini göstermez. Uzun sessizlik otomatik durdurma veya yeniden başlatma tetiklemez.</p>{sessions.length ? sessions.map(s => <div className="settings-row" key={s.id}><div><strong>{s.title}</strong><p className="hint">Son ilerleme: {displayTime(s.lastActivityAt)}</p></div><span className="mono">{s.state}</span></div>) : <p className="hint">Henüz kayıtlı oturum yok.</p>}</section>
  </section>;
}

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function SettingsPanel({ authDevice, theme, setTheme, remoteControlEnabled, canAct, onRefresh, onAuthRefresh, projects, onAddProject, notify }: {
  authDevice?: Device; theme: string; setTheme: (value: string) => void; remoteControlEnabled: boolean; canAct: boolean;
  onRefresh: () => Promise<void>; onAuthRefresh: () => Promise<void>; projects: Project[]; onAddProject: () => void; notify: (value: string) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revoke, setRevoke] = useState<Device | null>(null);
  const [permission, setPermission] = useState(notificationSupport() ? Notification.permission : 'unsupported');
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const refreshDevices = useCallback(async () => { try { setDevices((await api<{ devices: Device[] }>('/devices')).devices); } catch (e) { setError(errorText(e)); } }, []);
  useEffect(() => { void refreshDevices(); const capture = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); }; window.addEventListener('beforeinstallprompt', capture); return () => window.removeEventListener('beforeinstallprompt', capture); }, [refreshDevices]);
  async function perform(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function enablePush() {
    const state = await Notification.requestPermission(); setPermission(state);
    if (state !== 'granted') { notify('Bildirim izni verilmedi. Bekleyen işler uygulamada görünmeye devam eder.'); return; }
    const registration = await navigator.serviceWorker.ready;
    const { publicKey } = await api<{ publicKey: string }>('/push/key');
    const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    await api('/devices/push', { subscription: subscription.toJSON() }); await refreshDevices(); notify('Bu cihaz için bildirim bağlantısı kaydedildi. Test bildirimi gönderebilirsiniz.');
  }
  async function addPasskey() {
    const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/register/options', { name: authDevice?.name ?? 'Geçiş anahtarı' });
    const response = await startRegistration({ optionsJSON }); await api('/auth/register/verify', { response, name: authDevice?.name ?? 'Geçiş anahtarı' }); await onAuthRefresh(); await refreshDevices(); notify('Yeni geçiş anahtarı kaydedildi.');
  }
  return <section className="settings-page"><div className="page-heading"><div><p className="eyebrow">KİŞİSEL ÇALIŞMA ALANI</p><h1>Ayarlar</h1><p className="muted">Erişiminizi, cihazlarınızı ve bildirimlerinizi yönetin.</p></div></div>{error && <Notice tone="error">{error}</Notice>}
    <section className="settings-card"><div className="settings-row"><div><h2>Uzaktan komut kabulü</h2><p className="muted">Kapattığınızda yeni komut ve kararlar kabul edilmez. Çalışan ajan devam eder.</p></div><Button className={remoteControlEnabled ? '' : 'primary'} disabled={!canAct} busy={busy} onClick={() => void perform(async () => { await api('/control', { enabled: !remoteControlEnabled }); await onRefresh(); })}>{remoteControlEnabled ? 'Komut kabulünü durdur' : 'Komut kabulünü aç'}</Button></div></section>
    <section className="settings-card"><h2>Görünüm</h2><div className="theme-options">{[{ id: 'light', label: 'Açık', icon: Sun }, { id: 'dark', label: 'Koyu', icon: Moon }, { id: 'system', label: 'Sistem', icon: Laptop }].map(item => <Button key={item.id} className={theme === item.id ? 'selected' : ''} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}><item.icon size={18} />{item.label}</Button>)}</div></section>
    <section className="settings-card"><div className="settings-row"><div><h2>Cihaz kurulumu</h2><p className="muted">Ana ekrana ekleyin ve cevap bekleyen işler için bildirimleri açın.</p></div><Download size={24} /></div><div className="setup-steps"><div><strong>01 · Uygulamayı yükle</strong><p className="hint">{window.matchMedia('(display-mode: standalone)').matches ? 'Uygulama olarak açıldı.' : 'Tarayıcı menüsündeki “Ana ekrana ekle” seçeneğini kullanabilirsiniz.'}</p>{install && <Button onClick={() => void install.prompt()}><Download size={18} />Yükle</Button>}</div><div><strong>02 · Bildirim izni</strong><p className="hint">{permission === 'granted' ? 'İzin açık.' : permission === 'denied' ? 'İzin kapalı. Tarayıcı site ayarlarından değiştirebilirsiniz.' : permission === 'unsupported' ? 'Bu tarayıcı Web Push desteklemiyor.' : 'Bildirim izni henüz istenmedi.'}</p><Button disabled={!canAct || !notificationSupport() || permission === 'denied'} busy={busy} onClick={() => void perform(enablePush)}><Bell size={18} />Bildirimleri bağla</Button></div><div><strong>03 · Bağlantıyı sına</strong><p className="hint">Kilit ekranında kod, komut veya gizli içerik gösterilmez.</p><Button disabled={!canAct || permission !== 'granted'} busy={busy} onClick={() => void perform(async () => { const r = await api<{ sent: number; failed: number }>('/push/test', {}); notify(r.sent ? 'Test bildirimi sağlayıcıya iletildi. Telefonda ulaştığını kontrol edin.' : 'Bildirim gönderilemedi. Önce cihazı bağlayın; uygulama içi kartlar kullanılabilir.'); })}>Test bildirimi</Button></div></div></section>
    <section className="settings-card"><div className="settings-row"><div><h2>Geçiş anahtarları ve cihazlar</h2><p className="muted">Bir cihazı iptal etmek, o geçiş anahtarına bağlı tüm girişleri kapatır.</p></div><Button onClick={() => void perform(addPasskey)} busy={busy} disabled={!canAct}><Fingerprint size={18} />Anahtar ekle</Button></div>{devices.map(device => <div className="settings-row device-row" key={device.id}><Laptop size={23} /><div className="grow"><strong>{device.name} {device.id === authDevice?.id && <span className="badge info">Bu cihaz</span>}</strong><p className="hint">{device.revokedAt ? `İptal edildi: ${displayTime(device.revokedAt)}` : `Son erişim: ${displayTime(device.lastSeenAt)}`}</p></div><Button className="icon-button danger-text" disabled={!!device.revokedAt || !canAct} onClick={() => setRevoke(device)} aria-label={`${device.name} erişimini iptal et`}><Trash2 size={18} /></Button></div>)}</section>
    <section className="settings-card"><div className="settings-row"><div><h2>Proje profilleri</h2><p className="muted">Yalnız sunucuda izin verilen dizinler eklenebilir.</p></div><Button disabled={!canAct} onClick={onAddProject}><Plus size={18} />Proje ekle</Button></div>{projects.map(project => <div className="settings-row" key={project.id}><div><strong>{project.name}</strong><p className="mono hint">{project.cwd}</p><p className="hint">{project.mode === 'plan' ? 'Planlama modu' : 'Standart araç izinleri'} · API fallback kapalı</p></div><label className="checkbox-row"><input type="checkbox" checked={project.pushEnabled} disabled={!canAct || busy} onChange={event => { const pushEnabled = event.target.checked; void perform(async () => { await api(`/projects/${encodeURIComponent(project.id)}/preferences`, { pushEnabled }); await onRefresh(); }); }} />Proje bildirimleri</label></div>)}<Notice tone="info">DeepSeek için hesap bağlantısı ve uygulanabilir harcama sınırı doğrulanana kadar ücretli fallback açılmaz.</Notice></section>
    {revoke && <Modal title="Cihaz erişimini iptal et" onClose={() => setRevoke(null)} busy={busy}><p><strong>{revoke.name}</strong> cihazının kullandığı geçiş anahtarı ve bu anahtara bağlı oturumlar kapatılacak. Son anahtarı iptal ederseniz yeni kurulum kodu için sunucu erişimi gerekir.</p><div className="modal-actions"><Button onClick={() => setRevoke(null)}>Vazgeç</Button><Button className="danger" busy={busy} onClick={() => void perform(async () => { await api(`/devices/${encodeURIComponent(revoke.id)}/revoke`, {}); setRevoke(null); await onAuthRefresh(); await refreshDevices(); })}>Erişimi iptal et</Button></div></Modal>}
  </section>;
}
