const nodemailer = require('nodemailer');
const { emailUser, emailPass, emailFrom, smtpHost, smtpPort } = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!emailUser || !emailPass) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set to send emails');
  }
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
  return transporter;
}

function getSupervisorCredentialsHtml(username, password) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Supervisor Account - ConnectTeam</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); padding: 32px 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.025em;">ConnectTeam</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Your supervisor account</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">Your supervisor account has been created. Use the credentials below to sign in.</p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                      <p style="margin: 0 0 4px; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Username</p>
                      <p style="margin: 0; color: #1e293b; font-size: 16px; font-weight: 600;">${username}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 16px 20px;">
                      <p style="margin: 0 0 4px; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Password</p>
                      <p style="margin: 0; color: #1e293b; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.02em;">${password}</p>
                    </td>
                  </tr>
                </table>
              </div>
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">Sign in at the ConnectTeam login page. We recommend changing your password after your first login.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px 24px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">© ConnectTeam. This is an automated message. Keep your credentials secure.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

async function sendSupervisorCredentials(toEmail, username, password) {
  const from = emailFrom || emailUser;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `ConnectTeam <${from}>`,
    to: toEmail,
    subject: 'Your ConnectTeam Supervisor Account',
    text: `Your supervisor account has been created.\n\nUsername: ${username}\nPassword: ${password}\n\nSign in at the ConnectTeam login page. We recommend changing your password after your first login.`,
    html: getSupervisorCredentialsHtml(username, password),
  });
}

const PIN_EXPIRY_MINUTES = 10;

function getResetPinHtml(pin) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset - ConnectTeam</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); padding: 32px 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.025em;">ConnectTeam</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Password reset</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #475569; font-size: 15px; line-height: 1.6;">Use the PIN below to reset your password. This PIN expires in ${PIN_EXPIRY_MINUTES} minutes.</p>
              <div style="background-color: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <p style="margin: 0 0 8px; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Your PIN</p>
                <p style="margin: 0; color: #1e293b; font-size: 32px; font-weight: 700; letter-spacing: 0.25em; font-variant-numeric: tabular-nums;">${pin}</p>
              </div>
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">If you didn't request this reset, you can safely ignore this email. Your password will remain unchanged.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px 24px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">© ConnectTeam. This is an automated message.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

async function sendResetPinEmail(toEmail, pin) {
  const from = emailFrom || emailUser;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `ConnectTeam <${from}>`,
    to: toEmail,
    subject: 'Your password reset PIN - ConnectTeam',
    text: `Your password reset PIN is: ${pin}\n\nThis PIN expires in ${PIN_EXPIRY_MINUTES} minutes. Enter it on the reset password page to set a new password.\n\nIf you didn't request this, you can ignore this email.`,
    html: getResetPinHtml(pin),
  });
}

module.exports = { sendSupervisorCredentials, sendResetPinEmail };