import { useEffect, useState } from 'react';

// Кнопка встановлення застосунку (PWA). На Chrome/Edge (ПК, Android) використовує
// нативний prompt; на iPhone (Safari) prompt недоступний — показуємо інструкцію.
// Якщо застосунок уже встановлено (standalone) — нічого не рендеримо.
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
}

export default function InstallPWA({ variant = 'card' }: { variant?: 'card' | 'link' }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showHelp, setShowHelp] = useState(false);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const click = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => {});
      setDeferred(null);
    } else {
      setShowHelp(true); // нативного prompt немає (iOS / інший браузер) → інструкція
    }
  };

  const btnCls =
    variant === 'link'
      ? 'text-sm text-white/90 hover:text-white underline underline-offset-2'
      : 'w-full mt-4 flex items-center justify-center gap-2 border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium py-2 rounded-lg transition text-sm';

  return (
    <>
      <button onClick={click} className={btnCls}>📲 Встановити застосунок</button>

      {showHelp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800">Встановлення застосунку</h3>
              <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {isIOS ? (
              <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                <li>Відкрийте сайт у <b>Safari</b>.</li>
                <li>Натисніть кнопку <b>Поділитися</b> <span className="inline-block">⬆️</span> (внизу екрана).</li>
                <li>Виберіть <b>«На екран “Домівка”»</b> (Add to Home Screen).</li>
                <li>Натисніть <b>«Додати»</b> — іконка зʼявиться на екрані.</li>
              </ol>
            ) : (
              <div className="text-sm text-gray-700 space-y-3">
                <div>
                  <div className="font-semibold text-gray-800 mb-1">💻 На компʼютері (Chrome / Edge)</div>
                  <ol className="space-y-1 list-decimal list-inside">
                    <li>У правій частині <b>адресного рядка</b> натисніть іконку <b>⊕ / монітор зі стрілкою</b>.</li>
                    <li>Або меню <b>⋮</b> → <b>«Встановити застосунок…»</b>.</li>
                    <li>Підтвердіть — відкриється окремим вікном.</li>
                  </ol>
                </div>
                <div>
                  <div className="font-semibold text-gray-800 mb-1">📱 На Android (Chrome)</div>
                  <ol className="space-y-1 list-decimal list-inside">
                    <li>Меню <b>⋮</b> → <b>«Встановити застосунок»</b> (або «Додати на головний екран»).</li>
                    <li>Підтвердіть.</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
