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
