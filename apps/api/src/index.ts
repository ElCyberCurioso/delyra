import { createApp } from "./app";
import { handleNotificationBatch } from "./jobs/notifications-consumer";

export { SystemBackupWorkflow } from "./jobs/system-backup";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: (batch) => handleNotificationBatch(batch),
} satisfies ExportedHandler<Env>;
