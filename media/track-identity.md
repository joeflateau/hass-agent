# Stable track identity

The media snapshot version fences requests to an agent session, player process,
application bundle, title, artist and album. Observation timestamps, playback
progress and playing/paused state are not track identity.

Do not use macOS MediaRemote `contentItemIdentifier` as a persistent track ID.
Three metadata-only reads from Joe's Chrome PWA on macOS 25.6.0 returned different
UUIDs for that field while the process, app and visible metadata stayed unchanged.
Including it made every control's preflight reread reject the current track.

The agent still rereads immediately before native control, checks the exact
version and session, rejects old observations, serializes actions, consumes
request IDs and never retries an uncertain command. Removing a volatile native
identifier does not waive any of those checks.

Two consecutive items with identical process/app/title/artist/album cannot be
distinguished by this metadata. Do not invent stable identity from a volatile
native ID. A successful native command is `submitted`, not proof of causation.

## Command submission and subscription

The HA service returns after local MQTT publication, without waiting for Mac
receipts or a playback change. Play/pause uses a bounded temporary assumed state;
normal newer producer telemetry replaces it. Previous/Next never invent the next
item's metadata. Local publish failures still fail; later receipts are diagnostic.

A command reserves one short native-action slot, joins any existing bounded
metadata probe, and performs a fresh safety preflight. Other concurrent actions
are rejected, not queued/replayed. Successful native completion immediately emits
`submitted`; no confirmation reads, six-second wait, optimistic `observed` receipt,
or action retry. A failed/timed-out native call remains `unknown` because it may
have happened. The complete preflight/action has a 24-second cancellation ceiling,
and request IDs remain consumed across uncertainty. Epoch changes cancel native
work and fence late receipts.

Normal Mac metadata comes from the pinned helper's MediaRemote notification
stream, with full snapshots rather than deltas. Empty payload is idle. Events
update immediately and can arrive during an action; source/session/track fencing
still applies. A pending older successful probe never overwrites a newer event; a failed probe
still clears availability.
The stream provides no heartbeat: a bounded real metadata probe after ten quiet
seconds renews the 15-second lease. An independent active-login check runs every
ten seconds even under continuous events. A failed native eligibility check kills
and fences the stream; restart must pass login verification again. Stream silence
alone is not failure, and process liveness alone never refreshes observation time.
Source `position_at` remains unchanged by health observations or UI assumptions.
