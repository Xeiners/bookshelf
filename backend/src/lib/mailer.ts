import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config.js'
import { HttpError } from './errors.js'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Boîte d'envoi en mémoire (`MAIL_TRANSPORT=memory`, le défaut des tests) : les
 * tests y lisent le code de vérification comme le ferait l'utilisateur.
 */
export const outbox: MailMessage[] = []

/** `false` en production sans SMTP : l'inscription (qui exige un e-mail) est fermée. */
export const mailEnabled = config.mail.transport !== 'none'

let transporter: Transporter | null = null

function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.secure,
    auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass ?? '' } : undefined,
    // Un serveur SMTP lent ne doit pas bloquer l'inscription indéfiniment.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return transporter
}

export const emailUnavailable = () =>
  new HttpError(503, 'email_unavailable', 'Envoi d’e-mails non configuré : inscriptions fermées.')

/** Envoie un e-mail par le transport configuré. Échec SMTP → 502 `email_send_failed`. */
export async function sendMail(message: MailMessage): Promise<void> {
  switch (config.mail.transport) {
    case 'memory':
      outbox.push(message)
      return
    case 'console':
      // Développement sans SMTP : le message (et donc le code) s'affiche dans le terminal.
      console.log(`\n[mail] À : ${message.to}\n[mail] Objet : ${message.subject}\n${message.text}\n`)
      return
    case 'none':
      throw emailUnavailable()
    case 'smtp':
      try {
        await smtp().sendMail({ from: config.mail.from, ...message })
      } catch (error) {
        console.error('[mail] échec de l’envoi SMTP :', error instanceof Error ? error.message : error)
        throw new HttpError(502, 'email_send_failed', 'L’e-mail n’a pas pu être envoyé.')
      }
  }
}
