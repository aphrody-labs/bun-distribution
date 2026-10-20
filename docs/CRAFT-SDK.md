# Craft SDK for Bun and Aphrody

`@aphrody/bun-workspace/craft` resolves the 14 configured Craft engine libraries
from the canonical Aphrody module configuration. `listCraftLibraries` reads the
shared product capability catalog; `resolveCraftLibrary` locates an existing
qualified CLI artifact; `runCraftLibrary` runs that owner's CLI with its original
arguments and bounded process output. It does not translate the different CLI,
CLI-JSON, JSON-lines and MCP-stdio contracts into a new command language.

`craft-control.ts` contains a separate Bun-native JSON-lines client for the
documented loopback control servers of CADCraft, DeckCraft, DesignCraft,
EffectCraft, FigCraft, FilmCraft, GridCraft, LightCraft, PhotoCraft, SoundCraft,
VectorCraft and WordCraft. These servers are opt-in when each app starts. The
client never launches an app or discovers a port; a caller must provide the
local instance's port at call time. It connects only to `127.0.0.1`, opens one
connection per call, never multiplexes requests and does not retry a timed-out
operation. Method names and parameters remain owned by each engine; consult that
owner's `docs/libraries/<engine>/control-protocol.md` before calling it.

The client requires the running PhotoCraft instance's 256-bit token and the
running WordCraft instance's 256-bit control key. The caller reads those secrets
from the private per-instance location configured by the owner and passes them
directly to the connection call. The client does not persist or log them.
All other supported control channels are unauthenticated, opt-in loopback
interfaces; enable them only for a trusted local automation session.

Request lines are limited to 64 KiB. Responses default to 8 MiB and may be
raised to 64 MiB for an explicit caller that needs a large render. Calls default
to 30 seconds and can wait up to two minutes. At most 16 calls can hold active
connections in one Bun process. This bounds the client below the lowest
documented owner request limit and at the connection limit used by several
owners.

ArtCraft has no documented desktop TCP control server, and PDFCraft uses a
separate authenticated file-discovery control transport. Neither is exposed by
this TCP adapter. Their existing CLI and MCP interfaces remain available via
the Craft CLI SDK.
