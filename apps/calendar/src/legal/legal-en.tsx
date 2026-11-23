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
        voice into text (in Chrome, Google&apos;s; in Safari, Apple&apos;s). Delyra doesn&apos;t
        receive or store the audio: only the text that appears in the field, and only if you choose
        to add the event.
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
          as long as you have the account or until you delete it.
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
        </a>{" "}
        and ask whoever invited you to Delyra to export or delete your account.
      </p>
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
          Access may be withdrawn if these terms are broken. You can stop using Delyra and ask for
          your data to be deleted whenever you want.
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
