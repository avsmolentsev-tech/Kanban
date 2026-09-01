import { useState, type FormEvent } from 'react';
import { LiveKitRoom, VideoConference, PreJoin, type LocalUserChoices } from '@livekit/components-react';

/** Адрес сигналинга. Медиа сюда не идёт — оно летит напрямую в SFU по UDP. */
const LIVEKIT_URL = 'wss://livekit.clarity-space.ru';

type Stage =
  | { kind: 'форма' }
  | { kind: 'настройка'; token: string; room: string }
  | { kind: 'звонок'; token: string; choices: LocalUserChoices };

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'форма' });
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestToken(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), room: room.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? 'Не удалось получить доступ к комнате');
        return;
      }
      setStage({ kind: 'настройка', token: body.token, room: room.trim() });
    } catch {
      setError('Сервер не отвечает. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === 'форма') {
    return (
      <div className="вход">
        <form className="карточка" onSubmit={requestToken}>
          <h1>Clarity&nbsp;Meet</h1>
          <p className="подпись">Видеовстречи со стенограммой и задачами</p>

          <label>
            Как вас зовут
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Петров"
              autoComplete="name"
              required
              maxLength={60}
            />
          </label>

          <label>
            Комната
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="planerka"
              pattern="[a-zA-Z0-9\-]{2,40}"
              title="Латиница, цифры и дефис, от 2 до 40 символов"
              required
            />
          </label>

          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="ошибка">{error}</div>}

          <button type="submit" disabled={busy}>
            {busy ? 'Подключаемся…' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  if (stage.kind === 'настройка') {
    return (
      <div className="вход">
        <div className="карточка карточка--широкая">
          <h2>Проверьте камеру и микрофон</h2>
          <p className="подпись">Комната: {stage.room}</p>
          <PreJoin
            defaults={{ username: name, videoEnabled: true, audioEnabled: true }}
            onSubmit={(choices) => setStage({ kind: 'звонок', token: stage.token, choices })}
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
        token={stage.token}
        serverUrl={LIVEKIT_URL}
        connect
        video={stage.choices.videoEnabled}
        audio={stage.choices.audioEnabled}
        onDisconnected={() => setStage({ kind: 'форма' })}
        data-lk-theme="default"
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
