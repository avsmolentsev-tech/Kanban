import { useState, useEffect, type FormEvent } from 'react';
import { LiveKitRoom, VideoConference, PreJoin, type LocalUserChoices } from '@livekit/components-react';

/** Адрес сигналинга. Медиа сюда не идёт — оно летит напрямую в SFU по UDP. */
const LIVEKIT_URL = 'wss://livekit.clarity-space.ru';

type Комната = { id: string; title: string; защищена: boolean };

type Экран =
  | { вид: 'загрузка' }
  | { вид: 'создание' }
  | { вид: 'ссылка'; комната: Комната }
  | { вид: 'вход'; комната: Комната }
  | { вид: 'настройка'; token: string; комната: Комната }
  | { вид: 'звонок'; token: string; комната: Комната; выбор: LocalUserChoices };

/** Ссылка вида /r/xxx-xxx-xxx. Всё остальное — главная страница. */
function идИзАдреса(): string | null {
  const m = window.location.pathname.match(/^\/r\/([a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{3})\/?$/);
  return m ? m[1]! : null;
}

export default function App() {
  const [экран, setЭкран] = useState<Экран>({ вид: 'загрузка' });
  const [название, setНазвание] = useState('');
  const [имя, setИмя] = useState(() => localStorage.getItem('meet-имя') ?? '');
  const [парольСервиса, setПарольСервиса] = useState('');
  const [парольВстречи, setПарольВстречи] = useState('');
  const [ошибка, setОшибка] = useState<string | null>(null);
  const [занято, setЗанято] = useState(false);
  const [скопировано, setСкопировано] = useState(false);

  // При открытии по ссылке подтягиваем название встречи, чтобы человек видел,
  // куда он попал, ещё до ввода пароля.
  useEffect(() => {
    const id = идИзАдреса();
    if (!id) {
      setЭкран({ вид: 'создание' });
      return;
    }
    fetch(`/api/rooms/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setЭкран({ вид: 'вход', комната: await r.json() });
      })
      .catch(() => {
        setОшибка('Встреча не найдена. Проверьте ссылку.');
        setЭкран({ вид: 'создание' });
      });
  }, []);

  async function создатьВстречу(e: FormEvent) {
    e.preventDefault();
    setОшибка(null);
    setЗанято(true);
    try {
      const r = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: название.trim(),
          servicePassword: парольСервиса,
          roomPassword: парольВстречи,
        }),
      });
      const тело = await r.json().catch(() => ({}));
      if (!r.ok) { setОшибка(тело?.error ?? 'Не удалось создать встречу'); return; }
      window.history.pushState({}, '', `/r/${тело.id}`);
      setЭкран({ вид: 'ссылка', комната: тело });
    } catch {
      setОшибка('Сервер не отвечает.');
    } finally {
      setЗанято(false);
    }
  }

  async function войти(e: FormEvent) {
    e.preventDefault();
    if (экран.вид !== 'вход' && экран.вид !== 'ссылка') return;
    const комната = экран.комната;
    setОшибка(null);
    setЗанято(true);
    try {
      const r = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: имя.trim(), roomId: комната.id, password: парольВстречи }),
      });
      const тело = await r.json().catch(() => ({}));
      if (!r.ok) { setОшибка(тело?.error ?? 'Не удалось войти'); return; }
      localStorage.setItem('meet-имя', имя.trim());
      setЭкран({ вид: 'настройка', token: тело.token, комната });
    } catch {
      setОшибка('Сервер не отвечает.');
    } finally {
      setЗанято(false);
    }
  }

  function скопироватьСсылку(url: string) {
    navigator.clipboard.writeText(url).then(
      () => { setСкопировано(true); setTimeout(() => setСкопировано(false), 2000); },
      () => setОшибка('Не удалось скопировать — выделите ссылку вручную'),
    );
  }

  if (экран.вид === 'загрузка') {
    return <div className="вход"><div className="карточка"><p className="подпись">Загрузка…</p></div></div>;
  }

  if (экран.вид === 'создание') {
    return (
      <div className="вход">
        <form className="карточка" onSubmit={создатьВстречу}>
          <h1>Clarity&nbsp;Meet</h1>
          <p className="подпись">Видеовстречи со стенограммой и задачами</p>

          <label>
            Название встречи
            <input
              value={название}
              onChange={(e) => setНазвание(e.target.value)}
              placeholder="Планёрка с юристами"
              required
              maxLength={120}
              autoFocus
            />
          </label>

          <label>
            Пароль сервиса
            <input type="password" value={парольСервиса} onChange={(e) => setПарольСервиса(e.target.value)}
                   autoComplete="current-password" required />
          </label>

          <label>
            Пароль встречи
            <input type="password" value={парольВстречи} onChange={(e) => setПарольВстречи(e.target.value)}
                   autoComplete="new-password" placeholder="можно не задавать" />
            <span className="сноска">
              Оставьте пустым — тогда войти сможет любой, у кого есть ссылка.
            </span>
          </label>

          {ошибка && <div className="ошибка">{ошибка}</div>}

          <button type="submit" disabled={занято}>
            {занято ? 'Создаём…' : 'Создать встречу'}
          </button>
        </form>
      </div>
    );
  }

  if (экран.вид === 'ссылка') {
    const url = `${window.location.origin}/r/${экран.комната.id}`;
    return (
      <div className="вход">
        <div className="карточка">
          <h2>{экран.комната.title}</h2>
          <p className="подпись">Отправьте ссылку участникам</p>

          <div className="ссылка-блок">
            <code>{url}</code>
            <button type="button" className="кнопка--тихая" onClick={() => скопироватьСсылку(url)}>
              {скопировано ? 'Скопировано' : 'Копировать'}
            </button>
          </div>

          <p className="подпись">
            {экран.комната.защищена
              ? 'Пароль встречи сообщите отдельно — в ссылке его нет намеренно.'
              : 'Пароль не нужен: войдёт любой, у кого есть эта ссылка.'}
          </p>

          <form onSubmit={войти} style={{ display: 'contents' }}>
            <label>
              Ваше имя
              <input value={имя} onChange={(e) => setИмя(e.target.value)}
                     placeholder="Иван Петров" required maxLength={60} />
            </label>
            {ошибка && <div className="ошибка">{ошибка}</div>}
            <button type="submit" disabled={занято}>
              {занято ? 'Подключаемся…' : 'Войти во встречу'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (экран.вид === 'вход') {
    return (
      <div className="вход">
        <form className="карточка" onSubmit={войти}>
          <h2>{экран.комната.title}</h2>
          <p className="подпись">Вас пригласили на встречу</p>

          <label>
            Ваше имя
            <input value={имя} onChange={(e) => setИмя(e.target.value)}
                   placeholder="Иван Петров" required maxLength={60} autoFocus />
          </label>

          {экран.комната.защищена && (
            <label>
              Пароль встречи
              <input type="password" value={парольВстречи} onChange={(e) => setПарольВстречи(e.target.value)}
                     autoComplete="current-password" required />
            </label>
          )}

          {ошибка && <div className="ошибка">{ошибка}</div>}

          <button type="submit" disabled={занято}>
            {занято ? 'Подключаемся…' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  if (экран.вид === 'настройка') {
    return (
      <div className="вход">
        <div className="карточка карточка--широкая">
          <h2>Проверьте камеру и микрофон</h2>
          <p className="подпись">{экран.комната.title}</p>
          <PreJoin
            defaults={{ username: имя, videoEnabled: true, audioEnabled: true }}
            onSubmit={(выбор) => setЭкран({ вид: 'звонок', token: экран.token, комната: экран.комната, выбор })}
            joinLabel="Присоединиться"
            micLabel="Микрофон"
            camLabel="Камера"
            userLabel="Имя"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="звонок">
      <LiveKitRoom
        token={экран.token}
        serverUrl={LIVEKIT_URL}
        connect
        video={экран.выбор.videoEnabled}
        audio={экран.выбор.audioEnabled}
        onDisconnected={() => setЭкран({ вид: 'вход', комната: экран.комната })}
        data-lk-theme="default"
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
