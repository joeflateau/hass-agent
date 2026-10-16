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
distinguished by this metadata. Such a skip must remain `submitted` rather than
being called `observed` merely because the opaque identifier changed. The source
does not provide a guaranteed stable content ID; stronger same-metadata identity
would require an independently verified source capability, not a made-up ID.

## Command completion and polling

A background metadata poll is not a competing playback command. One action may
reserve the command slot and wait for that existing bounded read, then performs
a fresh preflight. Other actions are rejected rather than queued.

Native command completion can precede macOS/Chrome state propagation. The agent
sends exactly once, then observes for up to six seconds (250ms between reads)
for the expected state on the same track, or changed identity for skip. Changed
epoch, unavailable state, or changed track ends confirmation. Only an actual
matching observation produces `observed`; a deadline remains `submitted`, never
optimistic success. Reconnect/shutdown cancels observation and fences late reads.
The complete action has a 24-second cancellation deadline, including poll join,
runtime preparation and preflight. In-flight identical duplicates emit no premature
receipt; completed requests retain deduplication. `source_version` separately
fences the session/process/bundle, so a different player cannot confirm a skip.
The HA companion waits up to 30 seconds for the correlated receipt to cover an
existing poll, fresh preflight, native command, and bounded confirmation.
