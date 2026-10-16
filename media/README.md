# Mac Now Playing

## Product and ownership

Metadata and four native transport actions in the **existing hass-agent**
MQTT connection. Run in the active user's GUI LaunchAgent login. The frame talks
to HA; neither HA nor the frame needs SSH access or access to another macOS
user's login. The optional [Hass Agent Media companion](../custom_components/hass_agent_media/README.md)
automatically creates native HA `media_player` entities from these MQTT devices.
The existing sensor/buttons still work without the companion. On by default (`MEDIA_ENABLED=true`),
including on existing devices after upgrade; set `MEDIA_ENABLED=false` to disable. Device identity and broker
ACLs remain the existing agent's responsibility.

Run the existing agent in that user's GUI login. A successful
`hass-agent media-status` from that user's GUI Terminal qualifies the reader;
SSH in another account does not. The `/dev/console` owner and launchd `Aqua`
manager must match. Logging out/switching away makes media unavailable. There
is no privileged cross-login helper, source selection, app launch, volume, seek,
artwork, inferred source URL, arbitrary arguments, or shell command surface.

Spotify, Chrome/YouTube and browser-based Octo Brain playback use the same macOS
Now Playing reader, **only when the application actually publishes metadata**.
Source-specific field qualification is separate from packaging/source tests.

## HA and MQTT contract v1

For configured `DEVICE_ID` **D**, discovery unique IDs are `D_now_playing`,
`D_media_last_action`, and `D_media_play|pause|previous|next`. Names are **Now
Playing**, **Last Media Action**, **Media Play**, **Media Pause**, **Media Previous**,
**Media Next**, grouped under the existing Mac device. HA generates entity IDs
from names and the registry; locate the device/unique ID rather than assuming
an entity ID. Example defaults might be `sensor.joe_s_mac_mini_now_playing` and
`button.joe_s_mac_mini_media_next`; existing registry names may differ.

| Topic | Direction | Contract |
| --- | --- | --- |
| `hass-agent/D/media/state` | Mac → HA | Retained snapshot, QoS 0 |
| `hass-agent/D/media/command` | HA → Mac | Non-retained JSON request, QoS 0 |
| `hass-agent/D/media/result` | Mac → HA | Non-retained correlated receipt, QoS 0 |
| `homeassistant/status/D` | Existing agent LWT | Agent online/offline, QoS 1 retained |

The Now Playing sensor state is `playing`, `paused`, or `idle` (successful read,
no item). It becomes HA `unavailable` on failed reader/login, stale observation,
or agent offline. Its JSON attributes carry the complete snapshot:

```json
{
  "state": "playing",
  "session": "063c2fb6-511e-4e76-a624-2566fcc20878",
  "version": "64-character-sha256-track-identity",
  "observed_at": "2026-10-16T18:12:52.000Z",
  "title": "Example track", "artist": "Example artist", "album": null,
  "source": "com.google.Chrome",
  "duration": 247.919458, "position": 128.197555,
  "position_at": "2026-10-16T18:12:51Z", "rate": 1
}
```

`position_at` is the **original helper timestamp**, not refreshed at publication.
`observed_at` measures reader freshness, not timeline origin. Unknown fields are
null; idle/unavailable clear every track/progress field and `version`. Strings
are capped at 512 characters (source 256); numeric timeline values are finite,
nonnegative, at most 7 days; rate at most 8. Consumers must check state and
observation age ≤15 seconds even when HA still has old attributes. Extrapolate
only while playing, with a valid source timestamp/rate, and cap by duration;
never fabricate a progress origin when the timestamp is absent.

Use HA `button.press` on the four discovered buttons for ordinary HA controls.
HA's command template creates a fresh request ID and uses that button's current
snapshot attributes, so entity renames do not break it. HA 2026.8.3 supports MQTT
button `command_template` with `this`, but **does not support MQTT media_player
discovery**. Its native Universal player reads title/duration/position only from
child media players, not sensor attribute overrides; a Universal wrapper would
lose this metadata. The native [companion integration](../custom_components/hass_agent_media/README.md)
maps the real MQTT sensor into a `MediaPlayerEntity`, retaining metadata and the
correlated command protocol; it does not advertise unsupported MQTT discovery.

For a frame needing exact tap/result correlation, call **HA `mqtt.publish`**,
allowlisted to this single topic, with `qos: 0`, `retain: false`, and a payload:

```json
{
  "action": "next",
  "request_id": "frame-generated-unique-id-123456",
  "session": "copy-from-current-snapshot",
  "expected": "copy-current-version",
  "observed_at": "copy-current-observed_at"
}
```

Actions: `play`, `pause`, `previous`, `next` only. Request ID: 16–128 ASCII
letters/digits or `_.:+-`. Session, version and observed timestamp must be copied
from the current snapshot; invalid/retained/dup-flagged/oversize requests never
execute. Session rotates at startup, disconnect and reconnect, rejecting old
commands. Request age must be -2 through 15 seconds, including after preflight.
Track identity is re-read before any native action. Busy actions are rejected,
not queued. The controller consumes each request ID **before** asynchronous work
and deduplicates for 60 seconds; older requests already fail freshness. A new
session rejects every prior-session request, so crash recovery never replays it.

Receipt: `request_id`, `action`, `timestamp`, `status`, optional `reason`:

- `rejected`: no native action was sent.
- `observed`: helper returned, and a subsequent read matches play/pause or shows
  a different track for a skip. This is observed state, not proof of causation.
- `submitted`: helper returned, change not observed yet.
- `unknown`: native call failed/timed out after it may have happened.

`mqtt.publish`/`button.press` success confirms submission to HA, not playback.
Observe the **Last Media Action** sensor (or the exact result topic) and match
`request_id` for a correlated frame action. Results are not retained or replayed;
a lost result remains unknown. Never auto-retry a skip or infer success from a
later unrelated state change. Refresh current state before a deliberate new tap.
The shared household **Last Command** sensor/protocol is unchanged.

## Architecture, packaging and limits

`controller.ts` owns single-flight polling and playback. `mqtt.ts` owns discovery,
availability, reconnect invalidation and transport. `model.ts` bounds untrusted
helper output/requests. `process.ts` invokes exact executable/arguments without a
shell, kills at 4 seconds, limits stdout to 64 KiB, ignores stderr, and aborts on
shutdown. Media polling starts independently of battery/display/League/updates;
it schedules 5 seconds **after completion**, never accumulates polls or waits
in the other readers' lifecycle. No per-tick metadata logs or artwork loads.
Result ledger is bounded to 256 entries per minute; excess actions reject.
Sensor expires after 20 seconds; both sensor and buttons also require existing
agent availability and fresh, appropriate media state. Idle disables controls.
An independent one-second watchdog publishes unavailable if observation age
exceeds 15 seconds even when a pending media read never resolves, so HA buttons
do not depend on MQTT evaluating `now()` without a new message. The sensor's
20-second expiry remains a final fallback; the frame also checks its own lease.

`scripts/prepare-media-runtime.sh` checks out exact `media-control` v0.7.7 and
adapter commits (see [notices](../THIRD-PARTY-NOTICES.md)), builds universal Mach-O
files, verifies copied framework/client signatures and both CPU architectures,
and inventories **all** files/directories/internal relative framework symlinks.
macOS SEA builds embed every regular file as an asset plus an immutable manifest.
The runtime is therefore version-coupled to the binary, not to an ad-hoc install
or separately upgraded directory. No network download or compiler on endpoints.

At first use, `runtime.ts` extracts into a private content-addressed user cache,
verifies complete inventory/SHA256/modes/internal links and both code signatures,
then atomically renames staging. Every new agent process verifies a cached copy
again. Missing, extra or modified files fail closed; a failed/missing runtime
does not crash unrelated telemetry. Old content-addressed caches can be removed
while the agent is stopped; no automatic deletion/rollback of another runtime.
The auto-upgrade scheduler is unchanged. The installer validates the staged
binary signature and embedded runtime **before stopping** the current service,
keeps the previous executable at `~/.local/bin/hass-agent.previous`, then swaps
the new binary by same-directory atomic rename. If an operator needs rollback,
stop the LaunchAgent, copy the previous executable to a temporary file alongside
`hass-agent`, rename it over `hass-agent`, then start the LaunchAgent again.
Disable Automatic Upgrades first if retaining an older release intentionally.
No endpoint installer/service stop was run during source qualification.
These are ad-hoc code
signatures, not Developer ID notarization or proof of upstream authorship.

Build on macOS with Xcode command-line tools and CMake:

```sh
bash scripts/prepare-media-runtime.sh
npm run build
./hass-agent media-runtime-check  # extraction/integrity only; no metadata or control
./hass-agent media-status         # real user GUI login; metadata only
```

The Linux source/SEA build has no macOS runtime and is not a Mac release.
macOS builds fail if runtime assets are absent; hosted build/release builds
prepare them automatically. Runtime notices are embedded and shipped in archives.

## Qualification and replacement gates

1. Tests/typecheck and signed SEA build are source/artifact evidence only.
2. Published tag/assets must match reviewed source; do not infer release from PR.
3. Install/start **as Joe in his GUI login**, configure his own unique device ID
   and existing broker credentials, leave media enabled, run metadata-only status. Do
   not impersonate Joe or copy credentials into chat/repo. Verify HA device
   `sw_version` separately from publication, and verify current metadata/idle/
   unavailable states with no stale retained track accepted as current.
4. The frame owner selects the actual HA sensor/buttons or correlated MQTT
   contract, verifies end-to-end state, then performs deliberate authorized live
   control tests. No lock/sleep/League commands belong in music qualification.
5. Keep any temporary Joe-session bridge until the replacement is verified.
   Retire its LaunchAgent/socket/authorization only in its owning setup flow,
   with evidence the new path works. This PR neither retires it nor deploys HA
   or frame services.

A real console Chrome read of the pinned low-level helper has been observed.
That is not evidence of this new agent running in Joe's login, nor of Spotify,
Octo library, paused/idle states, live controls, or idle CPU for the final binary.
Measure representative idle/playing CPU after installation; no performance
success is inferred from the old Bun regression or unit tests.
