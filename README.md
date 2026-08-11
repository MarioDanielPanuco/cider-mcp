# cider-mcp

An MCP server that lets an agent control [Cider 4](https://cider.sh), the
third-party Apple Music client for macOS. It talks to Cider's local HTTP API
and, for the handful of things Cider doesn't expose (catalog search, playlist
creation), to Apple's Music API directly using tokens Cider already holds.

Targets MCP specification 2026-07-28 via `@modelcontextprotocol/server` ^2.0.0.

It gives an agent:

- **Playback** — play/pause/toggle, next/previous, seek, repeat, shuffle,
  rating, volume, and starting playback of a specific item or collection.
- **Queue** — list, jump, add next/later, move, remove, clear.
- **Library** — playlists, albums, artists, songs, and their tracks; add the
  current item to the library.
- **Catalog search** — search Apple Music for songs, albums, artists, and
  playlists; recently-played history.
- **Playlists** — create a playlist and append tracks to it.

The full tool list, with the exact input schema for each, lives in
[`src/tools/`](src/tools).

## Requirements

- macOS
- [Cider 4](https://cider.sh) installed, **running**, and signed in to Apple Music
- An active Apple Music subscription (catalog search and playlist writes need it)
- Node >= 20
- pnpm — used for the commands below. If you don't have it on your `PATH`,
  prefix each command with `npx --yes pnpm@9` (e.g. `npx --yes pnpm@9 install`),
  or run `corepack enable pnpm`.

## Setup

The published package on npm carries the server; you don't need to clone or build.

### Claude Code

One command — npx pulls `cider-mcp` from npm and runs it:

```sh
claude mcp add cider --scope user -- npx -y cider-mcp
```

### Claude Desktop

Add an entry to `claude_desktop_config.json`, then restart Desktop (it only reads
the config on launch):

```json
{
  "mcpServers": {
    "cider": {
      "command": "npx",
      "args": ["-y", "cider-mcp"]
    }
  }
}
```

### From source (for development)

To hack on the server, run it from a local clone instead:

```sh
git clone https://github.com/MarioDanielPanuco/cider-mcp.git
cd cider-mcp
pnpm install
pnpm build
claude mcp add cider --scope user -- node "$PWD/dist/index.js"
```

(For Claude Desktop from source, use `"command": "node"` with an absolute
`"<path-to-repo>/dist/index.js"` — the config has no shell expansion; run `pwd`
at the repo root to get the path.)

### First-run pairing

The first time the server starts, Cider shows an approval dialog requesting
five scopes: `playback`, `queue`, `library`, `audio`, and `account`. Approve
it. **Take your time** — the server waits indefinitely on purpose, so there's
no race against a timeout.

Once approved, the resulting app token is saved to the macOS Keychain (service
`cider-mcp`, account `app-token`) so you don't have to re-pair on every
restart.

## Security

**Read this before approving the pairing dialog.**

### What the `account` scope grants

`account` lets the server read Cider's MusicKit developer and user tokens
(`GET /api/v2/client/tokens`). It needs these because Cider's own API has no
search or playlist-write endpoints — those calls go straight to
`api.music.apple.com` instead. The important one is the **Music-User-Token**:
it's a bearer credential for your *entire* Apple Music account — library,
playlists, listening history — and it works from any host that presents it
with the right developer token and origin, not just this server.

### "Never written to disk" — with a caveat

The MusicKit tokens themselves are held in memory only and are never
persisted by this server. **But** the Cider *app token* — the one saved to
the Keychain — can be exchanged for those MusicKit tokens at any time via
Cider's `/api/v2/client/tokens`, as long as Cider is running. So the Keychain
item is functionally equivalent to holding the MusicKit tokens themselves: any
process running as your user can read it back with `security
find-generic-password -s cider-mcp -a app-token -w`, hand it to Cider, and get
live account credentials out. Treat that Keychain entry with the same care
you'd give a password.

### Reset / rotation

To revoke access:

```sh
security delete-generic-password -s cider-mcp -a app-token
```

Then also revoke it in Cider, under **Settings -> Connectivity -> Manage
External Application Access**, and restart the server — deleting only the
Keychain item still leaves Cider willing to hand out a token for this app.
Conversely, if you revoke access in Cider first but the server still has the
old token cached in the Keychain, it self-heals: on next start it detects the
rejection (Cider returns 403 / an unauthorized-token error), clears the stale
token, and re-runs the pairing dialog automatically.

### `spa-config.yml` fallback

If the pairing response is lost — the approval lands but the client never sees
the reply — the server can recover the token by reading Cider's
`spa-config.yml` directly. That file also contains tokens for *every other*
app you've paired with Cider, but this server only parses the entry matching
its own app name and never transmits the file or any other app's token
anywhere.

### Trust boundary: tool output is untrusted input

Everything a tool call returns — library contents, playlist names, recently
played history — is sent back to whatever LLM is powering your MCP client.
A track title or playlist name is free text and can contain anything a normal
string can, so treat tool output the way you'd treat any other untrusted text
reaching a model: don't assume it's inert. As one concrete guard against this
class of problem, `queue_clear` requires an explicit `confirm: true` argument,
specifically to make an accidental or instructed queue wipe harder to trigger
by surprise.

## What it cannot do

Playlists can be **created** and **appended to**, but not deleted, reordered,
or have tracks removed. `DELETE /v1/me/library/playlists/{id}` (and the
equivalent remove/reorder calls) return `401` with the token Cider holds, no
matter how the request is authenticated — this isn't a bug in this server,
it's a limitation of what that token is allowed to do. Deleting or reordering
a playlist has to happen in Cider's own UI.

### Held back: `play_url`

A `play_url` tool — play an Apple Music share link by pasting its URL — is
implemented but **deliberately not shipped in this release**. It is the only tool
that forwards a free-form, model-chosen URL to Cider, and out of caution around
handing the player an arbitrary URL it is held pending further review. A strict
allowlist (https + `music.apple.com` only, normalized before forwarding) already
guards it on the `feature/play-url` branch. Nothing is lost in the meantime:
`catalog_search` → `play_item` / `play_collection` plays anything `play_url`
would.

## Verified behaviour

Two things discovered during implementation, recorded here because they're
non-obvious and would otherwise be rediscovered the hard way:

- **Every Apple Music request needs `Origin: https://music.apple.com`.**
  Cider's developer token is origin-locked to apple.com; any other origin —
  including `cider.sh` or `localhost` — gets a 401.
- **`queue_move`'s `{from, to}` semantics are unverified.** Whether the index
  in `POST /api/v2/queue/move` is interpreted before or after the source item
  is removed hasn't been confirmed against a live queue. The tool ships with
  `from`/`to` matching Cider's schema, but this is the one tool whose behavior
  is inferred rather than tested end-to-end — confirm by hand (list the queue,
  move an item, list it again) before relying on it for anything precise.

## Recipes

The tools are deliberately small; the point is composing them. A few patterns
that fall out of the 34 that ship:

### Build a playlist from what you've been playing

`recently_played` returns your listening history with catalog ids attached.
Pick the tracks worth keeping and hand those ids to `playlist_create` —
last night's listening becomes a playlist in two calls. To grow it later,
append with `playlist_add_tracks` (your own playlists only — check `canEdit`
in `library_playlists`).

### Queue an energy arc

Every track that comes back from `now_playing`, `playback_state`, or
`queue_list` carries an `audio-analysis` block: bpm, musical key, energy,
valence, acousticness. So a queue doesn't have to be a pile. Gather candidates
with `catalog_search`, add them with `queue_add_later`, read the analysis back
from `queue_list`, then `queue_move` until energy climbs track over track —
calm openers, peak at the end. Invert the sort for a wind-down.

### A vibe, worked

"Walking home late, city empty, light rain." Rain-slick empty streets → sax
and neon → warmth as you get close. `queue_clear` (confirm: true) and
`set_shuffle` off so the arc holds, then `catalog_search` each track and
`queue_add_later` in order: open cold and lonely (Vangelis "Blade Runner
Blues", Bohren & der Club of Gore "Prowler"), ache underneath (Portishead
"Roads", Chet Baker "Almost Blue"), then let it warm as you near the door
(Khruangbin "So We Won't Forget", The Cinematic Orchestra "To Build a Home").
If the arc lands, `playlist_create` with the same ids keeps it.

## Development

```sh
npx --yes pnpm@9 test                     # unit tests
CIDER_MCP_SMOKE=1 npx --yes pnpm@9 smoke  # live check against a running Cider
```

The smoke test talks to a real, running Cider instance and **creates a real
playlist in your actual library** as part of exercising `playlist_create`.
Per [What it cannot do](#what-it-cannot-do), it cannot delete that playlist
through the API — the script prints the playlist id it created so you can
remove it by hand in Cider.

## Disclaimer

This is an independent, unofficial project. It is **not affiliated with or
endorsed by the Cider Collective**; it simply interoperates with the local API
that [Cider](https://cider.sh) exposes on your machine. All credit for Cider
itself goes to its authors.

Licensed under the [MIT License](LICENSE).
