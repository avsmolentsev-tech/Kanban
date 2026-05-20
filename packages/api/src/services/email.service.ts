import { Resend } from 'resend';
import { config } from '../config';

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export async function sendVerificationEmail(email: string, code: string, type: 'register' | 'reset'): Promise<void> {
  const subject = type === 'register'
    ? `${code} — код подтверждения Clarity Space`
    : `${code} — сброс пароля Clarity Space`;

  const html = type === 'register'
    ? `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
        <h2 style="color:#4f46e5">Clarity Space</h2>
        <p>Ваш код подтверждения:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f3f4f6;border-radius:12px;margin:16px 0">${code}</div>
        <p style="color:#6b7280;font-size:14px">Код действителен 10 минут. Если вы не регистрировались — проигнорируйте это письмо.</p>
      </div>`
    : `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
        <h2 style="color:#4f46e5">Clarity Space</h2>
        <p>Код для сброса пароля:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f3f4f6;border-radius:12px;margin:16px 0">${code}</div>
        <p style="color:#6b7280;font-size:14px">Код действителен 10 минут. Если вы не запрашивали сброс — проигнорируйте это письмо.</p>
      </div>`;

  if (!resend) {
    console.log(`[email] Resend not configured. Code for ${email}: ${code}`);
    return;
  }

  await resend.emails.send({
    from: config.emailFrom,
    to: email,
    subject,
    html,
  });
}

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
