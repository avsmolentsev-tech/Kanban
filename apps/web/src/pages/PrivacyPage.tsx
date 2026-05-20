import { useLangStore } from '../store/lang.store';
import { Link } from 'react-router-dom';

export function PrivacyPage() {
  const { t } = useLangStore();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <Link
          to="/"
          className="inline-block mb-8 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {t('← На главную', '← Back to home')}
        </Link>

        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-8">
          {t('Политика конфиденциальности', 'Privacy Policy')}
        </h1>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
          <p className="text-gray-500 dark:text-gray-400">
            {t('Последнее обновление: 13 мая 2026 г.', 'Last updated: May 13, 2026')}
          </p>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('1. Какие данные мы собираем', '1. What Data We Collect')}
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('Email-адрес и имя при регистрации.', 'Email address and name upon registration.')}</li>
              <li>{t('Данные задач, встреч, привычек, целей, записей дневника и документов, которые вы создаёте в сервисе.', 'Tasks, meetings, habits, goals, journal entries, and documents you create in the service.')}</li>
              <li>{t('Голосовые записи, отправленные для транскрибации (обрабатываются и удаляются после расшифровки).', 'Voice recordings sent for transcription (processed and deleted after transcription).')}</li>
              <li>{t('Метаданные использования сервиса (время входа, используемые функции).', 'Service usage metadata (login time, features used).')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('2. Как мы используем данные', '2. How We Use Data')}
            </h2>
            <p>
              {t(
                'Ваши данные используются исключительно для предоставления сервиса:',
                'Your data is used solely to provide the service:'
              )}
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{t('Хранение и отображение ваших задач, встреч, привычек и других записей.', 'Storing and displaying your tasks, meetings, habits, and other records.')}</li>
              <li>{t('AI-обработка через OpenAI API (генерация задач, AI-чат, анализ).', 'AI processing via OpenAI API (task generation, AI chat, analysis).')}</li>
              <li>{t('Транскрибация голосовых сообщений.', 'Voice message transcription.')}</li>
              <li>{t('Отправка уведомлений и напоминаний.', 'Sending notifications and reminders.')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('3. Хранение данных', '3. Data Storage')}
            </h2>
            <p>
              {t(
                'Все данные хранятся на серверах, расположенных в Санкт-Петербурге, Россия. Мы применяем стандартные меры безопасности для защиты ваших данных, включая шифрование соединений (HTTPS) и хеширование паролей.',
                'All data is stored on servers located in Saint Petersburg, Russia. We apply standard security measures to protect your data, including connection encryption (HTTPS) and password hashing.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('4. Третьи стороны', '4. Third Parties')}
            </h2>
            <p>
              {t(
                'Мы используем следующие сторонние сервисы для работы приложения:',
                'We use the following third-party services to operate the application:'
              )}
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>OpenAI</strong> — {t('обработка AI-запросов (текст задач, заметки, транскрипции).', 'AI request processing (task text, notes, transcriptions).')}</li>
              <li><strong>Resend</strong> — {t('отправка email-уведомлений (подтверждение email, сброс пароля).', 'sending email notifications (email verification, password reset).')}</li>
              <li><strong>Telegram</strong> — {t('интеграция с Telegram-ботом для управления задачами и получения уведомлений.', 'Telegram bot integration for task management and notifications.')}</li>
            </ul>
            <p className="mt-3 font-medium">
              {t(
                'Мы не продаём и не передаём ваши персональные данные третьим лицам в маркетинговых или иных коммерческих целях.',
                'We do not sell or share your personal data with third parties for marketing or other commercial purposes.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('5. Права пользователя', '5. User Rights')}
            </h2>
            <p>{t('Вы имеете право:', 'You have the right to:')}</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{t('Получить доступ ко всем своим данным в сервисе.', 'Access all your data in the service.')}</li>
              <li>{t('Экспортировать свои данные.', 'Export your data.')}</li>
              <li>{t('Запросить полное удаление всех данных и учётной записи.', 'Request complete deletion of all data and your account.')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('6. Cookies и хранилище', '6. Cookies and Storage')}
            </h2>
            <p>
              {t(
                'Мы используем localStorage браузера для хранения JWT-токена авторизации и пользовательских настроек (язык, тема). Мы не используем отслеживающие cookies и не устанавливаем cookies третьих сторон. Никакие данные не передаются рекламным или аналитическим системам.',
                'We use browser localStorage to store the JWT authorization token and user preferences (language, theme). We do not use tracking cookies or set third-party cookies. No data is transmitted to advertising or analytics systems.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('7. GDPR', '7. GDPR')}
            </h2>
            <p>
              {t(
                'В соответствии с принципами GDPR, вы имеете право на:',
                'In accordance with GDPR principles, you have the right to:'
              )}
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{t('Удаление данных (право на забвение) — все ваши данные будут удалены по запросу.', 'Data erasure (right to be forgotten) — all your data will be deleted upon request.')}</li>
              <li>{t('Переносимость данных — вы можете запросить экспорт всех данных в машиночитаемом формате.', 'Data portability — you can request export of all data in a machine-readable format.')}</li>
              <li>{t('Ограничение обработки — вы можете запросить прекращение обработки ваших данных AI-системами.', 'Restriction of processing — you can request that your data is no longer processed by AI systems.')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('8. Контакты', '8. Contact')}
            </h2>
            <p>
              {t(
                'По всем вопросам, связанным с конфиденциальностью и обработкой персональных данных, обращайтесь: ',
                'For any questions regarding privacy and personal data processing, contact us: '
              )}
              <a href="mailto:support@clarity-space.ru" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                support@clarity-space.ru
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
