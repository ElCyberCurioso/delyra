import type { Translation } from "@delyra/ui";
import type { AuthMessages } from "./messages";

const en: Translation<AuthMessages> = {
  notFound: {
    title: "Page not found",
    description: "The address doesn't exist or has changed.",
    home: "Go to the start page",
  },
  common: {
    email: "Email",
    password: "Password",
    repeatPassword: "Repeat the password",
    continue: "Continue",
    checking: "Checking…",
    retry: "Try again",
    sixDigits: "Enter the 6 digits shown in your app.",
    passwordsDontMatch: "The passwords don't match",
    completeTurnstile: "Complete the anti-bot check.",
    turnstileMissing:
      "The anti-bot check isn't set up in this environment. Tell the administrator.",
    backToLogin: "Back to sign in",
    signIn: "Sign in",
  },
  login: {
    title: "Sign in",
    description: "Access your calendar and your boards.",
    forgot: "Forgot your password?",
  },
  verify: {
    expiredTitle: "Session expired",
    expiredDescription: "Enter your email and password again.",
    title: "Two-step verification",
    recoveryDescription: "Type one of the recovery codes you saved. Each code works once.",
    totpDescription: "Open your authenticator app and type Delyra's 6-digit code.",
    recoveryCode: "Recovery code",
    code: "Code",
    recoveryIncomplete: "Enter a complete recovery code (xxxxx-xxxxx).",
    remainingCodes: (n) =>
      `You have ${String(n)} recovery codes left. Generate new ones from Settings if you run out.`,
    verifying: "Verifying…",
    verify: "Verify",
    useApp: "Use the authenticator app",
    passkeyDescription:
      "Use your passkey (fingerprint, face or device PIN) or the code from your authenticator app.",
    usePasskey: "Use a passkey",
    passkeyWaiting: "Waiting for the passkey…",
    orCode: "or with a code",
    passkeyCancelled:
      "The passkey wasn't used: it was cancelled or timed out. Try again or type a code.",
    useRecovery: "I don't have my phone: use a recovery code",
  },
  totp: {
    qrAlt: "QR code to add Delyra to your authenticator app",
    manual: "Can't scan it? Enter the key manually",
    fileTitle: "Delyra · recovery codes",
    fileGenerated: (when) => `Generated: ${when}`,
    fileOnce: "Each code works only once to sign in if you lose your phone.",
    fileStore: "Keep them in your password manager or somewhere safe.",
    fileName: "delyra-recovery-codes.txt",
    codesLabel: "Recovery codes",
    copied: "Codes copied",
    copyFailed: "Couldn't copy them",
    copy: "Copy",
    download: "Download",
    saved: "I've saved the codes somewhere safe.",
    saveTitle: "Save your recovery codes",
    saveDescription:
      "If you lose your phone, each of these codes lets you sign in once. You won't see them again.",
    setupFailed: "Couldn't prepare the verification",
    setupTitle: "Turn on two-step verification",
    setupDescription:
      "It's required. Scan the code with an authenticator app (Google Authenticator, 1Password, Bitwarden, Aegis…).",
    codeLabel: "6-digit code",
    activate: "Turn on",
  },
  register: {
    invalidTitle: "Invalid invitation",
    invalidDescription:
      "The link has expired, was already used or is incomplete. Ask the administrator for a new invitation.",
    title: "Create your account",
    invitedAs: "You've been invited as",
    afterwards: "Next you'll set up two-step verification.",
    name: "Name",
    passwordHint: (min) =>
      `At least ${String(min)} characters. A long phrase is easier to remember and more secure.`,
    creating: "Creating account…",
    create: "Create account",
  },
  forgot: {
    sentTitle: "Check your email",
    sentDescription:
      "If there's an account with that email, we've sent you a link to choose a new password. It expires in 30 minutes.",
    title: "Recover your password",
    description:
      "We'll send you a link to choose another one. Your two-step verification doesn't change.",
    sending: "Sending…",
    send: "Send link",
  },
  reset: {
    changed: "Password changed. Sign in with the new one.",
    invalidTitle: "Invalid link",
    invalidDescription:
      "The link is incomplete. Open it straight from the email or ask for another.",
    requestAnother: "Ask for another link",
    title: "Choose a new password",
    description: "All your open sessions will be signed out.",
    newPassword: "New password",
    minLength: (min) => `At least ${String(min)} characters.`,
    saving: "Saving…",
    change: "Change password",
  },
};

export default en;
