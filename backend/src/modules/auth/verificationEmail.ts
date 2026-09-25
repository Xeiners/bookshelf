import type { Language } from '../../lib/language.js'
import type { MailMessage } from '../../lib/mailer.js'

/*
 * E-mail du code de vérification. Mise en page en tableaux et styles en ligne :
 * c'est ce que Gmail, Outlook et Apple Mail rendent tous de la même façon. Les
 * couleurs reprennent celles de l'app (fond nuit, violet, crème).
 */

const COPY: Record<
  Language,
  {
    subject: (code: string) => string
    preheader: string
    greeting: (name: string | null) => string
    intro: string
    expiry: (minutes: number) => string
    ignore: string
    signature: string
  }
> = {
  fr: {
    subject: (code) => `${code} — ton code Bookshelf`,
    preheader: 'Ton code pour créer ton compte Bookshelf.',
    greeting: (name) => (name ? `Bonjour ${name},` : 'Bonjour,'),
    intro: 'Voici ton code pour terminer la création de ton compte Bookshelf :',
    expiry: (minutes) => `Il est valable ${minutes} minutes.`,
    ignore: 'Tu n’as pas demandé de compte ? Ignore simplement cet e-mail : aucun compte ne sera créé.',
    signature: 'Bookshelf — ta bibliothèque vivante',
  },
  en: {
    subject: (code) => `${code} — your Bookshelf code`,
    preheader: 'Your code to create your Bookshelf account.',
    greeting: (name) => (name ? `Hi ${name},` : 'Hi,'),
    intro: 'Here is your code to finish creating your Bookshelf account:',
    expiry: (minutes) => `It is valid for ${minutes} minutes.`,
    ignore: 'Didn’t ask for an account? Just ignore this email: no account will be created.',
    signature: 'Bookshelf — your living library',
  },
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Une case du code : chiffre en grand, sur fond sombre, liseré violet. */
const digitCell = (digit: string) =>
  `<td style="width:46px;height:58px;background:#16141f;border:1px solid #3a3160;border-radius:12px;text-align:center;vertical-align:middle;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;font-weight:700;color:#f7f5f0;">${digit}</td>`

const gapCell = (width: number) => `<td style="width:${width}px;"></td>`

export function buildVerificationEmail(input: {
  to: string
  code: string
  language: Language
  displayName: string | null
  minutes: number
}): MailMessage {
  const copy = COPY[input.language]
  const digits = input.code.split('')
  const grouped = `${input.code.slice(0, 3)} ${input.code.slice(3)}`
  const name = input.displayName ? escapeHtml(input.displayName) : null

  // 3 + 3 : les cases d'un groupe se touchent presque, un vrai vide sépare les deux groupes.
  const codeRow = [
    ...digits.slice(0, 3).flatMap((digit, index) => [digitCell(digit), index < 2 ? gapCell(8) : '']),
    `<td style="width:28px;text-align:center;color:#7c5cff;font-size:22px;font-weight:700;">·</td>`,
    ...digits.slice(3).flatMap((digit, index) => [digitCell(digit), index < 2 ? gapCell(8) : '']),
  ].join('')

  const html = `<!doctype html>
<html lang="${input.language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(copy.subject(grouped))}</title></head>
<body style="margin:0;padding:0;background:#06060a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06060a;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0b0b12;border:1px solid #1f1c2e;border-radius:24px;overflow:hidden;">
      <tr><td style="height:4px;background:linear-gradient(90deg,#7c5cff,#ff7eb6,#ffc46b);background-color:#7c5cff;"></td></tr>
      <tr><td style="padding:32px 32px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:36px;height:36px;background:#7c5cff;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:18px;font-weight:700;">B</td>
          <td style="padding-left:12px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#f7f5f0;">Bookshelf</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f7f5f0;font-size:16px;line-height:1.5;">
        <p style="margin:0 0 8px;">${copy.greeting(name)}</p>
        <p style="margin:0;color:#c9c6d4;">${escapeHtml(copy.intro)}</p>
      </td></tr>
      <tr><td align="center" style="padding:28px 16px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>${codeRow}</tr></table>
      </td></tr>
      <tr><td align="center" style="padding:0 32px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#9d9aab;">
        ${escapeHtml(copy.expiry(input.minutes))}
      </td></tr>
      <tr><td style="padding:0 32px;"><div style="height:1px;background:#1f1c2e;"></div></td></tr>
      <tr><td style="padding:20px 32px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8799;">
        ${escapeHtml(copy.ignore)}<br><br><span style="color:#b9a8ff;">${escapeHtml(copy.signature)}</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const text = [
    copy.greeting(input.displayName),
    '',
    copy.intro,
    '',
    `    ${grouped}`,
    '',
    copy.expiry(input.minutes),
    '',
    copy.ignore,
    '',
    copy.signature,
  ].join('\n')

  return { to: input.to, subject: copy.subject(grouped), text, html }
}
