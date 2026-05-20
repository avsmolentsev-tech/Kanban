import { useLangStore } from '../store/lang.store';
import { Link } from 'react-router-dom';

export function TermsPage() {
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
          {t('Условия использования', 'Terms of Service')}
        </h1>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
          <p className="text-gray-500 dark:text-gray-400">
            {t('Последнее обновление: 13 мая 2026 г.', 'Last updated: May 13, 2026')}
          </p>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('1. Описание сервиса', '1. Service Description')}
            </h2>
            <p>
              {t(
                'Clarity Space (clarity-space.ru) — это персональный инструмент продуктивности, включающий управление задачами (Kanban-доска), встречи, привычки, цели, дневник и AI-ассистент. Сервис предназначен для организации личной и рабочей деятельности.',
                'Clarity Space (clarity-space.ru) is a personal productivity tool that includes task management (Kanban board), meetings, habits, goals, journal, and an AI assistant. The service is designed to organize personal and work activities.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('2. Обязанности пользователя', '2. User Responsibilities')}
            </h2>
            <p>
              {t(
                'Используя Clarity Space, вы обязуетесь:',
                'By using Clarity Space, you agree to:'
              )}
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{t('Не злоупотреблять сервисом и не использовать его для причинения вреда другим пользователям или третьим лицам.', 'Not abuse the service or use it to harm other users or third parties.')}</li>
              <li>{t('Не загружать незаконный, оскорбительный или нарушающий авторские права контент.', 'Not upload illegal, offensive, or copyright-infringing content.')}</li>
              <li>{t('Не пытаться получить несанкционированный доступ к данным других пользователей.', 'Not attempt to gain unauthorized access to other users\' data.')}</li>
              <li>{t('Обеспечивать безопасность своей учётной записи и пароля.', 'Ensure the security of your account and password.')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('3. Использование AI', '3. AI Usage')}
            </h2>
            <p>
              {t(
                'Clarity Space использует OpenAI API для работы AI-функций: генерации задач из встреч, AI-чата, анализа привычек и других интеллектуальных возможностей. При использовании AI-функций ваши данные (текст задач, заметки, транскрипции) отправляются в OpenAI для обработки. OpenAI обрабатывает данные в соответствии со своей политикой конфиденциальности.',
                'Clarity Space uses the OpenAI API for AI features: generating tasks from meetings, AI chat, habit analysis, and other intelligent capabilities. When using AI features, your data (task text, notes, transcriptions) is sent to OpenAI for processing. OpenAI processes data in accordance with its privacy policy.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('4. Хранение данных', '4. Data Storage')}
            </h2>
            <p>
              {t(
                'Ваши данные хранятся на серверах, расположенных в России. Вы являетесь владельцем своих данных. Мы не претендуем на права собственности на контент, который вы создаёте в сервисе.',
                'Your data is stored on servers located in Russia. You own your data. We do not claim ownership of the content you create in the service.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('5. Учётная запись', '5. Account')}
            </h2>
            <p>
              {t(
                'Вы можете удалить свою учётную запись в любое время, обратившись в службу поддержки. При удалении аккаунта все ваши данные будут безвозвратно удалены с наших серверов.',
                'You can delete your account at any time by contacting support. When your account is deleted, all your data will be permanently removed from our servers.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('6. Отказ от гарантий', '6. Disclaimer')}
            </h2>
            <p>
              {t(
                'Сервис предоставляется «как есть» (as is), без каких-либо гарантий, явных или подразумеваемых. Мы не гарантируем бесперебойную работу сервиса, отсутствие ошибок или сохранность данных. Мы прилагаем разумные усилия для обеспечения стабильной работы, но не несём ответственности за потерю данных или перебои в работе.',
                'The service is provided "as is", without any warranties, express or implied. We do not guarantee uninterrupted service, absence of errors, or data preservation. We make reasonable efforts to ensure stable operation, but are not liable for data loss or service interruptions.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('7. Изменение условий', '7. Changes to Terms')}
            </h2>
            <p>
              {t(
                'Мы оставляем за собой право изменять настоящие условия использования в любое время. Обновлённые условия вступают в силу с момента их публикации на данной странице. Продолжение использования сервиса после изменения условий означает ваше согласие с ними.',
                'We reserve the right to change these terms of service at any time. Updated terms take effect upon publication on this page. Continued use of the service after changes constitutes your acceptance of the updated terms.'
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {t('8. Контакты', '8. Contact')}
            </h2>
            <p>
              {t(
                'По всем вопросам обращайтесь: ',
                'For any questions, contact us: '
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
