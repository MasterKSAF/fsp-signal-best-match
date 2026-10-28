# Private PDF import worker

Build locally: `docker build -t signal-pdf-import:1 ops/pdf-import`.
The API requires a local Docker-compatible engine; configure `SIGNAL_DOCKER_BIN`
if its executable is absent from PATH. No Python package is required on the API host.
Production should set `SIGNAL_PDF_IMAGE` to the built image's immutable digest.
Missing image/engine returns a controlled unavailable response, never an
unrestricted parser fallback. Disabling the worker leaves manual CV editing usable.

Each document runs as uid65532, without network, mounts, capabilities or writable
root. Limits:5MiB upload,12pages,32MiB expanded streams,256MiB memory/no swap,
1CPU,32PIDs,8CPU seconds,15wall seconds,16MiB ephemeral tmp and120k text characters.
The parent force-removes the owned container on timeout/output overflow.

Source bytes are pipe-only and discarded. Private extraction drafts expire after
24h; expired content is purged by the application retention task. No external
OCR/LLM, PDF scripts, embedded files or external links are executed. A scan is
reported as lacking a visible text layer. Extraction is heuristic: complete
rectangle coverage, text paint mode/opacity, effective size, page bounds and
duplicate layers are checked; arbitrary complex clipping/image occlusion may
still require human review. The review UI always shows provenance and diff.

See the primary [text trace documentation](https://pymupdf.readthedocs.io/en/latest/functions.html#Page.get_texttrace).
PyMuPDF1.26.5 is pinned; its license is AGPL3/commercial. Review distribution
licensing before shipping a proprietary distribution; do not silently change
the application's license. The worker remains a separate optional service.
