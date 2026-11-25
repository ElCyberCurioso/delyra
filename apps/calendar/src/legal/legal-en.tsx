import { Link } from "@tanstack/react-router";

/** Texto en inglés de las páginas legales (F7-06). La versión en español manda si difieren. */

export function PrivacyEn() {
  return (
    <>
      <p>
        Delyra is a personal calendar and task manager for private use, with invitation-only access.
        This page explains what data it handles and why.
      </p>

      <h2>Data Delyra keeps</h2>
      <ul>
        <li>
          Your account: name, email, password (only its hash) and the second factor (encrypted). If
          you add passkeys, only their public key and the name you give them: your fingerprint, face
          or PIN never leave your device.
        </li>
        <li>What you create: calendars, events, alerts, boards, cards and attachments.</li>
        <li>If you link Telegram, your chat identifier (encrypted), to send you alerts.</li>
        <li>Technical security records (sign-ins, account changes).</li>
      </ul>

      <h2>Google data</h2>
      <p>
        Only if you ask for it, Delyra connects to your Google account with{" "}
        <strong>read-only calendar</strong> permission (<code>calendar.readonly</code>) to import,
        once, your calendars (name, colour and time zone), their events (with their repeats) and
        their reminders, or to keep the ones you choose in sync.
      </p>
      <ul>
        <li>
          To import once, no permanent permission is kept: the temporary access token (one hour at
          most) is stored encrypted only while the calendars are downloaded and is deleted
          afterwards.
        </li>
        <li>
          If you turn on syncing, Delyra stores an encrypted read-only refresh token and the email
          of that Google account, and checks the calendars you chose for changes every 15 minutes.
          It&apos;s deleted as soon as you press “Disconnect Google” (which also revokes the
          permission in Google) or if Google withdraws it.
        </li>
        <li>
          The downloaded data is kept temporarily (7 days at most) until you choose what to import,
          and is deleted when the import finishes.
        </li>
        <li>
          What you import becomes part of your calendar in Delyra and only you can see it. It
          isn&apos;t sold, shared with third parties, used for advertising or used to train AI
          models.
        </li>
        <li>
          The use of information received from Google APIs adheres to the{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noopener noreferrer"
            target="_blank"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </li>
      </ul>
      <p>
        If you subscribe to a calendar&apos;s secret iCal address, Delyra stores that address
        encrypted and checks it every hour to keep a read-only copy up to date. You can remove the
        subscription at any time.
      </p>

      <h2>Voice dictation</h2>
      <p>
        If you use the microphone for quick add, your browser&apos;s dictation service turns your
        voice into text (in Chrome, Google&apos;s; in Safari, Apple&apos;s) or, in the Android app,
        your phone&apos;s speech recognition (on most phones, Google&apos;s). Delyra doesn&apos;t
        receive or store the audio: only the text that appears in the field, and only if you choose
        to add the event.
      </p>

      <h2>Android app</h2>
      <p>
        The app keeps your session on your phone, encrypted with the Android keystore, so you
        don&apos;t have to sign in every time, and a copy of what you last viewed (agenda and
        boards) so you can open it offline. Both are deleted when you sign out, and neither goes
        into your phone&apos;s backups or moves to another device. The app has no ads, no analytics
        and no tracking of any kind.
      </p>

      <h2>Where it&apos;s stored</h2>
      <p>
        On Cloudflare&apos;s infrastructure (database and storage in the European Union), with
        backups encrypted at rest.
      </p>

      <h2>How long</h2>
      <ul>
        <li>
          Your account and what you create (calendars, events, boards, cards and attachments): for
          as long as you have the account or until you delete it. If you delete your account,
          everything is deleted right away; it only stays in system backups until they expire.
        </li>
        <li>
          System backups: daily ones, 30 days; weekly ones, 12 weeks; monthly ones, 1 year. Your own
          backups, as many as you choose to keep in Settings.
        </li>
        <li>
          Expired or signed-out sessions, sign-in attempts, password reset links and unused
          invitations: deleted 30 days after they expire.
        </li>
        <li>Your account&apos;s security history (sign-ins and changes): 1 year.</li>
      </ul>

      <h2>Microsoft 365 data</h2>
      <p>
        Only if you turn it on for a board, Delyra reads your Microsoft 365 calendar with{" "}
        <strong>read-only</strong> permission (<code>Calendars.Read</code>) to turn your meetings
        into cards. From each meeting it only takes the subject, time, location, the
        organiser&apos;s name and the Teams link; never the content or the attendee list.
      </p>
      <ul>
        <li>
          It stores, encrypted, the access permission (which Microsoft renews periodically) and the
          email of the connected account, and deletes them when you press “Disconnect Microsoft
          365”.
        </li>
        <li>
          The cards it creates are part of your board: the people you share it with can see them,
          and they stay even if you disconnect.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can delete what you imported at any time (by deleting the calendar), revoke
        Delyra&apos;s access from{" "}
        <a
          className="underline"
          href="https://myaccount.google.com/permissions"
          rel="noopener noreferrer"
          target="_blank"
        >
          your Google account
        </a>
        , download a copy of everything from Settings → Backups and{" "}
        <Link to="/borrar-cuenta" className="underline">
          delete your account
        </Link>{" "}
        whenever you want.
      </p>
    </>
  );
}

export function AccountDeletionEn({ done }: { done: boolean }) {
  return (
    <>
      {done ? (
        <p role="status" className="rounded-xl border border-border bg-card p-3 font-medium">
          Your account has been deleted. We&apos;ve sent you an email to confirm it.
        </p>
      ) : null}
      <p>
        You can delete your Delyra account yourself whenever you want, on the web or in the Android
        app. It&apos;s deleted right away and can&apos;t be undone.
      </p>

      <h2>How</h2>
      <ul>
        <li>
          On the web: sign in to delyra.app and go to{" "}
          <Link to="/ajustes" hash="eliminar" className="underline">
            Settings → Delete account
          </Link>
          .
        </li>
        <li>In the Android app: Settings → Delete account.</li>
        <li>
          You&apos;ll be asked for your password and the code from your authenticator app (or a
          recovery code).
        </li>
        <li>
          If you can&apos;t sign in, reset your password with “Forgot your password?”. If you lost
          your second factor and your recovery codes, ask whoever invited you to reset it from
          Delyra&apos;s administration.
        </li>
      </ul>

      <h2>What gets deleted</h2>
      <ul>
        <li>
          Your account: name, email, password, second factor, passkeys, sessions and security
          history.
        </li>
        <li>
          What you created: calendars, events, alerts, boards, cards, attachments and your backups.
          Boards you shared are deleted for the people you shared them with too.
        </li>
        <li>
          Your connections to Google (the permission is revoked), Microsoft 365 and Telegram, and
          your iCal subscriptions.
        </li>
      </ul>

      <h2>What stays</h2>
      <ul>
        <li>Comments you left on other people&apos;s boards, without your name.</li>
        <li>
          System backups, which expire on their own: within a year at most (see the{" "}
          <Link to="/privacidad" className="underline">
            privacy policy
          </Link>
          ).
        </li>
      </ul>
    </>
  );
}

export function TermsEn() {
  return (
    <>
      <p>Delyra is a private, free, invitation-only service. By using it you accept these terms.</p>
      <h2>Use</h2>
      <ul>
        <li>Your account is personal: protect your password and your second factor.</li>
        <li>Don&apos;t upload illegal content or try to access other people&apos;s data.</li>
        <li>
          Imports and syncing with Google happen at your request and only read the calendars of the
          account you connect with.
        </li>
      </ul>
      <h2>Service</h2>
      <ul>
        <li>
          It&apos;s provided “as is”, with no availability guarantees. Telegram alerts depend on
          third-party services and may be delayed.
        </li>
        <li>Backups are made, but you should export whatever matters to you.</li>
        <li>
          Access may be withdrawn if these terms are broken. You can stop using Delyra and delete
          your account whenever you want, from Settings.
        </li>
      </ul>
      <p>
        See also the{" "}
        <Link to="/privacidad" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </>
  );
}
