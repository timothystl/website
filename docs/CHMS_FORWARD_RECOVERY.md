# Website-to-Connect delivery recovery

Contact and prayer submissions are delivered to the church office first. A secondary copy is
queued in `chms_forward_outbox` and sent to Connect asynchronously. Connect downtime must never
turn successful office delivery into a failed visitor submission.

The worker retries due rows every 15 minutes with a four-second request deadline and exponential
backoff, stopping automatically after eight attempts. A stable `X-Idempotency-Key` accompanies
every retry. Successful rows are deleted immediately so the queue does not become a second archive
of form contents. Logs and push alerts identify only the form kind, attempt number, and random
delivery key; they never include form contents or configuration values.

## Manual recovery

1. Open Website Admin → Filtered Mail and review the **Connect delivery** status.
2. Confirm the Connect Worker is healthy and the service binding and intake secret still exist.
3. Select **Retry pending copies now**. This resets exhausted rows and makes one bounded attempt.
4. Refresh the page. A zero pending count confirms delivery; successful rows have been deleted.
5. If rows remain, use Worker logs and the displayed HTTP status/error category. Do not copy form
   payloads, credentials, or internal deployment identifiers into tickets or chat.

If a row cannot be delivered after the dependency is restored, preserve it for engineering review;
do not delete it merely to clear the counter.
