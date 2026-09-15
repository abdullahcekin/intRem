import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Activity, AlertCircle, ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CirclePause, Command, Fingerprint, FolderPlus, Info, Laptop, LoaderCircle, LockKeyhole, LogOut, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Radio, RefreshCw, Search, Settings as SettingsIcon, ShieldCheck, Terminal, Wifi, WifiOff, X } from 'lucide-react';
import type { AppSnapshot, Device, DiscoveredSession, Interaction, Project, Session } from '../shared/types';
import { api, errorText, setCsrfToken } from './api';
import { displayTime, sessionLabels } from './helpers';
import { Conversation } from './Conversation';
import { InteractionDialog } from './InteractionDialog';
import { SettingsPanel, HealthPanel } from './Settings';

type AuthStatus = { authenticated: boolean; setupRequired: boolean; csrfToken?: string; device?: Device };
export type Page = 'sessions' | 'pending' | 'health' | 'settings';
type ModalKind = 'project' | 'session' | 'import' | null;
const navigation = [
  { id: 'sessions' as const, title: 'Oturumlar', icon: MessageSquare },
  { id: 'pending' as const, title: 'Bekleyenler', icon: Bell },
  { id: 'health' as const, title: 'Sistem', icon: Activity },
  { id: 'settings' as const, title: 'Ayarlar', icon: SettingsIcon },
];

export function Button({ children, className = '', busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} className={`button ${className}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>{busy && <LoaderCircle className="spinner" size={18} aria-hidden="true" />}{children}</button>;
}

export function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'error' | 'info' | 'success' }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}><AlertCircle size={18} aria-hidden="true" /><div>{children}</div></div>;
}

export function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const target = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); target?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) closeRef.current(); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <div className="modal-heading"><h2>{title}</h2><Button className="icon-button subtle" onClick={onClose} disabled={busy} aria-label="Pencereyi kapat"><X size={22} /></Button></div>
    {children}
  </dialog>, document.body);
}

export function StatusBadge({ state, source }: { state: Session['state']; source?: Session['source'] }) {
  const waiting = state === 'waiting_answer' || state === 'permission_required';
  if (source === 'imported' && !waiting) return <span className="badge muted"><LockKeyhole size={13} />Yalnız izleme</span>;
  return <span className={`badge ${waiting || state === 'delivery_unknown' ? 'warning' : state === 'working' ? 'info' : state === 'offline' ? 'muted' : 'success'}`}>
    {waiting ? <Bell size={13} /> : state === 'working' ? <Activity size={13} /> : state === 'offline' ? <WifiOff size={13} /> : state === 'delivery_unknown' ? <AlertCircle size={13} /> : <Check size={13} />}
    {sessionLabels[state]}
  </span>;
}

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><span className="brand-mark"><Terminal size={small ? 21 : 26} strokeWidth={2} /></span><div><strong>intRem</strong>{!small && <span>Oturum kontrolü</span>}</div></div>;
}

function Login({ auth, onAuthenticated }: { auth: AuthStatus; onAuthenticated: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('Kişisel cihazım');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const supported = window.isSecureContext && 'PublicKeyCredential' in window;
  async function login() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      if (auth.setupRequired) {
        const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/register/options', { bootstrapToken: token, name });
        const response = await startRegistration({ optionsJSON });
        await api('/auth/register/verify', { response, name });
        setToken('');
      } else {
        const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/login/options', {});
        const response = await startAuthentication({ optionsJSON });
        await api('/auth/login/verify', { response });
      }
      await onAuthenticated();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); guard.current = false; }
  }
  return <main className="login-page"><div className="login-wrap"><Brand /><section className="login-card">
    <div className="login-symbol"><Fingerprint size={34} /></div>
    <div><p className="eyebrow">{auth.setupRequired ? 'İLK KURULUM' : 'GÜVENLİ ERİŞİM'}</p><h1>{auth.setupRequired ? 'İlk cihazınızı bağlayın' : 'Çalışmanıza bağlanın'}</h1><p className="muted">{auth.setupRequired ? 'Sunucunuzdaki kurulum anahtarıyla bu cihaz için bir passkey oluşturun.' : 'Projeleriniz ve bekleyen kararlarınız, passkey ile giriş yaptıktan sonra burada.'}</p></div>
    <form onSubmit={event => { event.preventDefault(); void login(); }}>
      {auth.setupRequired && <><label className="field">Cihaz adı<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoComplete="off" /></label><label className="field">Kurulum anahtarı<input type="password" value={token} onChange={event => setToken(event.target.value)} required autoComplete="off" spellCheck={false} aria-describedby="bootstrap-help" /><span id="bootstrap-help" className="hint">Sunucu yöneticisinden aldığınız tek kullanımlık kod. İlk passkey’i oluşturmak için kullanılır.</span></label></>}
      {!supported && <Notice>Passkey için HTTPS ve destekleyen bir tarayıcı gerekir. Uygulamayı güvenli alan adından açın.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="primary full" busy={busy} disabled={!supported || (auth.setupRequired && (!token.trim() || !name.trim()))}><Fingerprint size={20} />{auth.setupRequired ? 'Passkey oluştur ve bağlan' : 'Passkey ile giriş yap'}<ArrowRight size={18} /></Button>
    </form>
    <div className="login-footnote"><ShieldCheck size={17} /><span>Bu cihazın erişimini daha sonra Ayarlar’dan iptal edebilirsiniz.</span></div>
  </section><a className="login-guide" href="/info"><Info size={18} aria-hidden="true" />Kullanım rehberi</a><p className="login-caption">Tek sunucu. Tüm projeleriniz. Kontrol sizde.</p></div></main>;
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [page, setPage] = useState<Page>('sessions');
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('session'));
  const [online, setOnline] = useState(navigator.onLine);
  const [synced, setSynced] = useState(false);
  const [stream, setStream] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [navigationHidden, setNavigationHidden] = useState(false);
  const [listHidden, setListHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('intrem:theme') || 'system'; } catch { return 'system'; } });
  const refreshSequence = useRef(0);
  const eventCursor = useRef(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      // Mobile keyboards can resize only the visual viewport, leaving 100dvh unchanged.
      const unzoomed = !viewport || viewport.scale === 1;
      document.documentElement.style.setProperty('--app-height', unzoomed ? `${viewport?.height ?? window.innerHeight}px` : '100dvh');
      document.documentElement.style.setProperty('--app-top', unzoomed ? `${viewport?.offsetTop ?? 0}px` : '0px');
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('resize', resize); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('intrem:theme', theme); } catch { /* Theme remains usable without storage. */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const loadAuth = useCallback(async () => {
    setAuthError('');
    try { const status = await api<AuthStatus>('/auth/status'); setCsrfToken(status.csrfToken); setAuth(status); }
    catch (error) { setAuthError(errorText(error)); }
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    try {
      const data = await api<AppSnapshot>('/snapshot');
      if (sequence === refreshSequence.current) { eventCursor.current = data.cursor; setSnapshot(data); setSynced(true); setError(''); }
    } catch (error) { if (sequence === refreshSequence.current) { setError(errorText(error)); setSynced(false); } }
    finally { if (sequence === refreshSequence.current) setRefreshing(false); }
  }, []);
  useEffect(() => { void loadAuth(); }, [loadAuth]);
  useEffect(() => {
    const unavailable = () => { refreshSequence.current++; setCsrfToken(); setAuth({ authenticated: false, setupRequired: false }); setSnapshot(null); setSynced(false); };
    const connected = () => { setOnline(true); setSynced(false); if (auth?.authenticated) void refresh(); else void loadAuth(); };
    const disconnected = () => { setOnline(false); setSynced(false); setStream(false); };
    window.addEventListener('intrem:unauthorized', unavailable);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('intrem:unauthorized', unavailable); window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [auth?.authenticated, refresh, loadAuth]);
  useEffect(() => {
    if (!auth?.authenticated || !online) return;
    let disposed = false;
    let events: EventSource | undefined;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    void refresh().then(() => {
      if (disposed) return;
      events = new EventSource(`/api/events/stream?after=${eventCursor.current}`);
      events.onopen = () => { setStream(true); };
      events.addEventListener('update', () => {
        if (scheduled) return;
        scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 150);
      });
      events.onerror = () => { setStream(false); };
    });
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; events?.close(); clearTimeout(scheduled); clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [auth?.authenticated, online, refresh]);

  const chooseSession = (id: string) => {
    setSelectedId(id); setPage('sessions');
    const url = new URL(location.href); url.searchParams.set('session', id); history.replaceState(null, '', url);
  };
  const pending = snapshot?.interactions.filter(item => item.status === 'pending') || [];
  const selected = snapshot?.sessions.find(session => session.id === selectedId);
  const selectedProject = snapshot?.projects.find(project => project.id === selected?.projectId);
  const conversationOpen = page === 'sessions' && Boolean(selected && selectedProject);
  const focused = conversationOpen && focusMode;
  const interaction = snapshot?.interactions.find(item => item.id === interactionId);
  const canAct = online && synced;
  const filtered = snapshot?.sessions.filter(session => {
    const project = snapshot.projects.find(project => project.id === session.projectId);
    return (!projectFilter || session.projectId === projectFilter) && `${session.title} ${project?.name || ''} ${project?.cwd || ''}`.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'));
  }) || [];

  if (!auth && (!online || authError)) return <main className="loading-page"><Brand /><Notice>{!online ? 'Çevrimdışısınız.' : authError}</Notice><p>Cihaz erişimi ve güncel oturumlarınız sunucu bağlantısı doğrulandıktan sonra açılır.</p><Button disabled={!online} onClick={() => void loadAuth()}><RefreshCw size={18} />Yeniden dene</Button><a className="login-guide" href="/info"><Info size={18} aria-hidden="true" />Kullanım rehberi</a></main>;
  if (!auth) return <main className="loading-page"><Brand /><p><LoaderCircle className="spinner" size={20} /> Güvenli bağlantı kontrol ediliyor…</p></main>;
  if (!auth.authenticated) return <Login auth={auth} onAuthenticated={loadAuth} />;

  return <div className={`app-layout ${navigationHidden || focused ? 'navigation-hidden' : ''} ${conversationOpen ? 'conversation-open' : ''} ${focused ? 'focus-mode' : ''}`}>
    <aside className="sidebar" id="workspace-navigation"><Brand small /><div className="workspace-label"><span className="server-dot" />Kişisel çalışma alanı</div><nav aria-label="Ana gezinme">
      {navigation.map(item => <button key={item.id} onClick={() => setPage(item.id)} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined}><item.icon size={20} /><span>{item.title}</span>{item.id === 'pending' && pending.length > 0 && <span className="nav-count">{pending.length}</span>}</button>)}
    </nav><div className="sidebar-projects"><div className="section-label"><span>PROJELER</span><Button className="subtle icon-button" onClick={() => setModal('project')} disabled={!canAct} aria-label="Proje ekle"><Plus size={17} /></Button></div>
      {(snapshot?.projects || []).map(project => <button className={`project-link ${projectFilter === project.id ? 'selected' : ''}`} key={project.id} onClick={() => { setProjectFilter(projectFilter === project.id ? '' : project.id); setPage('sessions'); }}><span className="project-letter">{project.name.slice(0, 1).toLocaleUpperCase('tr')}</span><span>{project.name}</span><span className="muted">{snapshot?.sessions.filter(session => session.projectId === project.id).length}</span></button>)}
      {snapshot && !snapshot.projects.length && <p className="hint">İlk projenizi ekleyerek başlayın.</p>}
    </div><div className="sidebar-bottom"><div className="connection-line">{online ? <Wifi size={17} /> : <WifiOff size={17} />}<span>{!online ? 'Çevrimdışı' : synced ? 'Sunucuya bağlı' : 'Eşitleniyor'}</span></div><p>{auth.device?.name || 'Doğrulanmış cihaz'}</p></div></aside>

    <div className="main-area"><header className="topbar"><div className="mobile-brand"><Brand small /></div><div className="breadcrumb"><Button className="panel-toggle navigation-toggle" title="Ana gezinme" aria-expanded={!navigationHidden} aria-controls="workspace-navigation" onClick={() => setNavigationHidden(!navigationHidden)}>{navigationHidden ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}<span>{navigationHidden ? 'Menüyü aç' : 'Menüyü gizle'}</span></Button><span className="breadcrumb-context">Çalışma alanı</span><ChevronRight className="breadcrumb-context" size={15} /><strong className="breadcrumb-context">{navigation.find(item => item.id === page)?.title}</strong></div><div className="topbar-actions"><span className={`stream-state ${stream ? 'connected' : ''}`}><Radio size={14} />{stream ? 'Canlı güncellemeler' : 'Periyodik güncelleme'}</span><a className="button icon-button subtle guide-button" href="/info" aria-label="Kullanım rehberi" title="Kullanım rehberi"><Info size={20} aria-hidden="true" /></a><Button className="icon-button subtle" aria-label="Durumu yenile" title="Durumu yenile" onClick={() => void refresh()} disabled={!online} busy={refreshing}>{!refreshing && <RefreshCw size={19} />}</Button><Button className="device-avatar" onClick={() => setPage('settings')} aria-label="Cihaz ayarlarını aç"><Laptop size={20} /></Button></div></header>
      <div className="global-notices" aria-live="polite">
        {!online && <Notice>Çevrimdışısınız. Mesajınız bu oturumun taslağında kalır; bağlantı gelince kendiliğinden gönderilmez.</Notice>}
        {online && !synced && snapshot && <Notice>Güncel durum henüz doğrulanamadı. Mesaj ve karar gönderimi eşitleme tamamlanana kadar kapalı.</Notice>}
        {snapshot && !snapshot.remoteControlEnabled && <Notice>Uzaktan yeni komut kabulü duraklatıldı. Çalışan ajanlar devam edebilir. Ayarlar’dan yeniden açabilirsiniz.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <div className="dismissible"><Notice tone="success">{notice}</Notice><Button className="icon-button subtle" aria-label="Bildirimi kapat" onClick={() => setNotice('')}><X size={17} /></Button></div>}
      </div>
      {!snapshot ? <div className="loading-content"><LoaderCircle className="spinner" size={25} /><h1>Çalışma alanınız yükleniyor</h1><p>Projeler ve oturumlar sunucudan alınıyor.</p></div> : <>
        {page === 'sessions' && <section className={`sessions-view ${selected ? 'has-selection' : ''} ${conversationOpen && (listHidden || focused) ? 'list-hidden' : ''}`}>
          <div className="session-list" id="session-list"><div className="page-heading"><div><p className="eyebrow">ÇALIŞMA ALANI</p><h1>Oturumlar <span className="heading-count">{snapshot.sessions.length}</span></h1></div><Button className="primary icon-button" onClick={() => setModal(snapshot.projects.length ? 'session' : 'project')} disabled={!canAct || !snapshot.remoteControlEnabled} aria-label={snapshot.projects.length ? 'Yeni oturum başlat' : 'İlk projeyi ekle'}><Plus size={22} /></Button></div>
            <label className="search-field"><Search size={18} /><span className="sr-only">Oturumlarda ara</span><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Oturum veya proje ara" /></label>
            <div className="list-tools"><label><span className="sr-only">Proje filtresi</span><select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">Tüm projeler</option>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><Button className="subtle compact" onClick={() => setModal('import')} disabled={!canAct}><Search size={16} />Mevcut oturumu bağla</Button></div>
            {filtered.length ? <div className="session-rows">{filtered.map(session => {
              const project = snapshot.projects.find(project => project.id === session.projectId);
              const waiting = pending.filter(item => item.sessionId === session.id).length;
              return <button className={`session-row ${selectedId === session.id ? 'selected' : ''}`} key={session.id} onClick={() => chooseSession(session.id)} aria-pressed={selectedId === session.id}><span className="session-row-top"><span className="project-name">{project?.name || 'Proje bulunamadı'}</span><time>{displayTime(session.updatedAt)}</time></span><strong>{session.title}</strong><span className="session-row-status"><StatusBadge state={session.state} source={session.source} />{waiting > 0 && <span className="pending-count">{waiting} bekleyen</span>}</span><span className="session-row-meta">{project?.host || 'Host bilinmiyor'}<span>·</span>{session.source === 'managed' ? 'intRem ile başlatıldı' : 'Kaynak oturum bağlandı'}</span></button>;
            })}</div> : <div className="empty-list"><MessageSquare size={30} /><h2>{snapshot.sessions.length ? 'Eşleşen oturum yok' : 'Henüz oturum yok'}</h2><p>{snapshot.sessions.length ? 'Arama metnini veya proje filtresini değiştirin.' : 'Bir projede yeni bir çalışma başlatın veya mevcut Claude oturumunuzu bağlayın.'}</p><Button className="primary" onClick={() => setModal(snapshot.projects.length ? 'session' : 'project')} disabled={!canAct || !snapshot.remoteControlEnabled}><Plus size={18} />{snapshot.projects.length ? 'Yeni oturum başlat' : 'İlk projeyi ekle'}</Button></div>}
            <div className="list-footer"><LockKeyhole size={14} />Oturum hedefleri her işlemde doğrulanır.</div>
          </div>
          {selected && selectedProject ? <Conversation key={selected.id} session={selected} project={selectedProject} interactions={snapshot.interactions.filter(item => item.sessionId === selected.id)} cursor={snapshot.cursor} canAct={canAct && snapshot.remoteControlEnabled} onRefresh={refresh} onInteraction={setInteractionId} focusMode={focused} onToggleFocus={() => setFocusMode(!focusMode)} listHidden={listHidden} onToggleList={() => setListHidden(!listHidden)} onBack={() => { setSelectedId(null); setFocusMode(false); const url = new URL(location.href); url.searchParams.delete('session'); history.replaceState(null, '', url); }} /> : <div className="empty-detail"><div className="empty-detail-icon"><Terminal size={37} /></div><p className="eyebrow">İŞİNİZE YAKIN KALIN</p><h2>{selectedId ? 'Oturum bulunamadı' : 'Bir oturum seçin'}</h2><p>{selectedId ? 'Bu bağlantıdaki oturum artık erişilebilir değil. Listeden güncel bir oturum açın.' : 'Konuşmayı, bekleyen kararları ve doğrulanmış oturum bilgilerini burada takip edin.'}</p><div className="empty-detail-facts"><span><MessageSquare size={17} />Konuşma geçmişi</span><span><ShieldCheck size={17} />Kontrollü kararlar</span></div></div>}
        </section>}
        {page === 'pending' && <main className="page-content"><div className="page-heading"><div><p className="eyebrow">SİZDEN YANIT BEKLİYOR</p><h1>Bekleyenler <span className="heading-count">{pending.length}</span></h1><p className="muted">Her kararı, ilgili proje ve isteğin içeriğiyle birlikte değerlendirin.</p></div></div>{pending.length ? <div className="pending-grid">{pending.map(item => {
          const session = snapshot.sessions.find(session => session.id === item.sessionId);
          const project = snapshot.projects.find(project => project.id === session?.projectId);
          return <button className="pending-card" key={item.id} onClick={() => setInteractionId(item.id)}><span className="pending-card-top"><span className={`badge ${item.kind === 'permission' ? 'warning' : 'info'}`}>{item.kind === 'permission' ? <ShieldCheck size={14} /> : <MessageSquare size={14} />}{item.kind === 'permission' ? 'Araç izni' : item.kind === 'plan' ? 'Plan kararı' : 'Soru'}</span><ChevronRight size={20} /></span><strong>{project?.name || 'Proje bulunamadı'}</strong><span>{item.toolName}</span><span className="pending-preview">{item.kind === 'question' && Array.isArray(item.input.questions) ? String((item.input.questions[0] as { question?: unknown })?.question || 'Soruları açın') : 'Tam istek içeriğini inceleyin'}</span><span className="hint">{project?.host} · {displayTime(item.createdAt)}</span><span className="mono path">{project?.cwd}</span></button>;
        })}</div> : <div className="empty-state"><span className="empty-success"><Check size={32} /></span><h2>Bekleyen karar yok</h2><p>Bir oturum yanıtınızı veya izninizi istediğinde burada görünecek.</p><Button onClick={() => setPage('sessions')}>Oturumlara dön<ArrowRight size={17} /></Button></div>}</main>}
        {page === 'health' && <HealthPanel online={online} stream={stream} sessions={snapshot.sessions} />}
        {page === 'settings' && <SettingsPanel authDevice={auth.device} theme={theme} setTheme={setTheme} remoteControlEnabled={snapshot.remoteControlEnabled} canAct={canAct} onRefresh={refresh} onAuthRefresh={loadAuth} projects={snapshot.projects} onAddProject={() => setModal('project')} notify={setNotice} />}
      </>}
      <footer className="mobile-nav"><nav aria-label="Mobil ana gezinme">{navigation.map(item => <button key={item.id} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'active' : ''}><span><item.icon size={21} />{item.id === 'pending' && pending.length > 0 && <i>{pending.length}</i>}</span>{item.title}</button>)}</nav></footer>
    </div>
    {modal && snapshot && <CreateDialog kind={modal} projects={snapshot.projects} onClose={() => setModal(null)} onCreated={async session => { await refresh(); setModal(null); if (session) chooseSession(session.id); }} />}
    {interaction && snapshot && <InteractionDialog item={interaction} session={snapshot.sessions.find(session => session.id === interaction.sessionId)} project={snapshot.projects.find(project => project.id === snapshot.sessions.find(session => session.id === interaction.sessionId)?.projectId)} canAct={canAct && snapshot.remoteControlEnabled} onClose={() => setInteractionId(null)} onRefresh={refresh} />}
  </div>;
}

function CreateDialog({ kind, projects, onClose, onCreated }: { kind: Exclude<ModalKind, null>; projects: Project[]; onClose: () => void; onCreated: (session?: Session) => Promise<void> }) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [mode, setMode] = useState('default');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveredSession[] | null>(null);
  const [picked, setPicked] = useState<string>('');
  const project = projects.find(project => project.id === projectId);
  const discover = useCallback(async () => {
    setBusy(true); setError('');
    try { const result = await api<{ sessions: DiscoveredSession[] }>('/discovery'); setDiscovery(result.sessions); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (kind === 'import') void discover(); }, [kind, discover]);
  async function submit() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      if (kind === 'project') { await api('/projects', { name: name.trim(), cwd: cwd.trim(), mode }); await onCreated(); }
      if (kind === 'session') { const session = await api<Session>('/sessions', { projectId, title: name.trim() || undefined }); await onCreated(session); }
      if (kind === 'import') {
        const source = discovery?.find(session => `${session.claudeSessionId}:${session.pid}` === picked);
        if (!source) throw new Error('Bağlanacak oturumu seçin.');
        const session = await api<Session>('/sessions/import', { claudeSessionId: source.claudeSessionId, pid: source.pid, projectId });
        await onCreated(session);
      }
    } catch (error) { setError(errorText(error)); }
    finally { guard.current = false; setBusy(false); }
  }
  return <Modal title={kind === 'project' ? 'Proje ekle' : kind === 'session' ? 'Yeni oturum başlat' : 'Mevcut oturumu bağla'} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}>
    {kind === 'project' ? <><p className="muted">Sunucunuzdaki bir çalışma dizinini proje olarak tanımlayın.</p><label className="field">Proje adı<input required value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Örneğin: Ürün uygulaması" /></label><label className="field">Sunucudaki çalışma dizini<input required value={cwd} onChange={event => setCwd(event.target.value)} placeholder="/home/kullanici/projeler/uygulama" spellCheck={false} autoComplete="off" /><span className="hint">Dizin sunucuda var olmalı ve izinli proje kökleri altında bulunmalı.</span></label><label className="field">Başlangıç modu<select value={mode} onChange={event => setMode(event.target.value)}><option value="default">Standart</option><option value="plan">Plan</option></select></label></> : <><label className="field">Hedef proje<select required value={projectId} onChange={event => setProjectId(event.target.value)}><option value="" disabled>Proje seçin</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{project && <div className="target-box"><strong>{project.name}</strong><span>{project.host}</span><code>{project.cwd}</code></div>}{!projects.length && <Notice>Önce bir proje ekleyin. Bağlanacak oturumun çalışma dizini bu projeyle eşleşmeli.</Notice>}
      {kind === 'session' ? <><label className="field">Oturum adı <span className="hint">(isteğe bağlı)</span><input value={name} onChange={event => setName(event.target.value)} maxLength={150} placeholder="Örneğin: API iyileştirmeleri" /></label><p className="hint">Yeni bir intRem oturumu oluşturulur. İlk mesajınızla ajan çalışmaya başlar.</p></> : <><Notice tone="info">Canlı kaynak oturum kendiliğinden kapatılmaz. Bağladıktan sonra izleyebilirsiniz; kaynak süreç çıktıktan sonra konuşmayı intRem’de sürdürebilirsiniz.</Notice><div className="section-label"><span>BULUNAN OTURUMLAR</span><Button type="button" className="subtle" onClick={() => void discover()} busy={busy}><RefreshCw size={16} />Tara</Button></div>{discovery === null ? <p className="muted">İzinli dizinlerdeki oturumlar taranıyor…</p> : !discovery.length ? <div className="empty-compact"><Search size={24} /><p>Bağlanabilecek oturum bulunamadı.</p><span className="hint">Claude oturumunun izinli bir proje dizininde olduğundan emin olun.</span></div> : <div className="discovery-list">{discovery.map(source => <label key={`${source.claudeSessionId}:${source.pid}`} className="discovery-option"><input type="radio" name="discovery" value={`${source.claudeSessionId}:${source.pid}`} checked={picked === `${source.claudeSessionId}:${source.pid}`} onChange={event => setPicked(event.target.value)} /><span><strong>{source.title}</strong><code>{source.cwd}</code><span className="hint">PID {source.pid} · {source.active ? 'Kaynak süreç canlı' : 'Kaynak süreç kapalı'}</span><code>{source.claudeSessionId}</code></span></label>)}</div>}</>}
    </>}
    {error && <Notice tone="error">{error}</Notice>}<div className="modal-actions"><Button type="button" onClick={onClose} disabled={busy}>Vazgeç</Button><Button type="submit" className="primary" busy={busy} disabled={(kind === 'project' && (!name.trim() || !cwd.trim())) || (kind !== 'project' && !projectId) || (kind === 'import' && !picked)}>{kind === 'project' ? 'Projeyi ekle' : kind === 'session' ? 'Oturumu oluştur' : 'Seçilen oturumu bağla'}</Button></div>
  </form></Modal>;
}
