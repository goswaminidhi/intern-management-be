import 'dotenv/config';
import type { UserAttributes } from '../models/user';

// Only the fields the emails actually need, so any User instance works
export type EmailRecipient = Pick<UserAttributes, 'name' | 'email' | 'role'>;
export type PasswordResetRecipient = Pick<UserAttributes, 'name' | 'email'>;

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: unknown = ''): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

interface SendEmailParams {
  toEmail: string;
  toName: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

/**
 * Sends an email using Brevo's v3 REST API (HTTPS).
 * Completely bypasses SMTP port blocking on cloud providers like Render.
 */
async function sendViaBrevoApi({
  toEmail,
  toName,
  subject,
  htmlContent,
  textContent,
}: SendEmailParams): Promise<void> {
  const apiKey = (process.env.BREVO_API_KEY || process.env.BREVO_KEY || '').trim();
  const senderEmail = (
    process.env.BREVO_SENDER_EMAIL ||
    process.env.EMAIL_USER ||
    ''
  ).trim();
  const senderName = (
    process.env.BREVO_SENDER_NAME || 'Intern Management System'
  ).trim();

  if (!apiKey) {
    console.error('ERROR: BREVO_API_KEY is not defined in environment variables.');
    throw new Error('Email service configuration error: BREVO_API_KEY is missing.');
  }

  if (!senderEmail) {
    console.error('ERROR: BREVO_SENDER_EMAIL is not defined in environment variables.');
    throw new Error('Email service configuration error: BREVO_SENDER_EMAIL is missing.');
  }

  const payload = {
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [
      {
        email: toEmail,
        name: toName || toEmail,
      },
    ],
    subject,
    htmlContent,
    textContent,
  };

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Brevo API email failed (${response.status} ${response.statusText}):`, errorBody);
    throw new Error(`Failed to send email via Brevo: ${response.statusText}`);
  }
}

export async function sendLoginCredentials(
  user: EmailRecipient,
  temporaryPassword: string
): Promise<void> {
  const frontendBase = (
    process.env.FRONTEND_URL || 'http://localhost:5173'
  ).replace(/\/+$/, '');
  const loginLink = `${frontendBase}/`;

  const subject = 'Your Intern Management System Login Details';

  const textContent = `
Hello ${user.name},

Your ${user.role} account has been created.

Login link: ${loginLink}
Email: ${user.email}
Temporary password: ${temporaryPassword}

For security reasons, you must change your temporary password
when you log in for the first time.

If you did not expect this email, please contact your administrator.
  `.trim();

  const htmlContent = `
    <h2>Welcome, ${escapeHtml(user.name)}!</h2>

    <p>Your ${escapeHtml(user.role)} account has been created.</p>

    <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>

    <p><strong>Temporary password:</strong>
        <code>${escapeHtml(temporaryPassword)}</code>
    </p>

    <p>You must change your password the first time you log in.</p>

    <a href="${loginLink}"
       style="display:inline-block;
              padding:12px 20px;
              background:#007bff;
              color:white;
              text-decoration:none;
              border-radius:5px;">
        Log In to Your Account
    </a>

    <p>If you did not expect this email, please contact your administrator.</p>
  `;

  await sendViaBrevoApi({
    toEmail: user.email,
    toName: user.name,
    subject,
    htmlContent,
    textContent,
  });
}

export async function sendPasswordResetOTP(
  user: PasswordResetRecipient,
  otp: string
): Promise<void> {
  const subject = 'Password Reset OTP';

  const textContent = `
Hello ${user.name},

We received a request to reset your password.

Your OTP is: ${otp}

This OTP expires in 5 minutes.

If you did not request a password reset, please ignore this email.
  `.trim();

  const htmlContent = `
    <h2>Password Reset</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <p>Use the following OTP to reset your password:</p>
    <h2 style="letter-spacing: 4px; color: #2563eb;">${escapeHtml(otp)}</h2>
    <p>This OTP expires in 5 minutes.</p>
    <p>If you did not request a reset, please ignore this email.</p>
  `;

  await sendViaBrevoApi({
    toEmail: user.email,
    toName: user.name,
    subject,
    htmlContent,
    textContent,
  });
}
