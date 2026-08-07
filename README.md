# Ironflow — Public Releases

[![Latest version](https://img.shields.io/github/v/release/sahina/ironflow-releases?label=ironflow&color=blue)](https://github.com/sahina/ironflow-releases/releases/latest)

Continuous History for backend systems. One binary for events, workflows, projections, and time-travel.

- Website: <https://ironflow.run>
- Documentation: <https://docs.ironflow.run>
- Getting started: <https://docs.ironflow.run/tutorials/getting-started/>
- **Latest release: <https://github.com/sahina/ironflow-releases/releases/latest>**

This repository is the **public distribution point** for Ironflow. The engine source is closed
(see [License](#license)); this repo exists so that `brew install`, `docker pull`, `helm install`,
and direct binary downloads resolve without authentication.

It also carries the deploy artifacts and runnable examples the docs reference — clone it and run them:

```bash
git clone https://github.com/sahina/ironflow-releases
cd ironflow-releases/deploy/docker-compose      # single-node + cluster compose stacks
cd ironflow-releases/deploy/terraform/hetzner   # Hetzner provisioning
cd ironflow-releases/examples/quickstart        # runnable example apps
```

## Install

Full guide with all options: <https://docs.ironflow.run/tutorials/installation/>

### Homebrew (macOS, Linux)

```bash
brew tap sahina/tap
brew install ironflow

ironflow serve            # SQLite + embedded NATS on :9123
ironflow serve --open     # and open the dashboard
```

### Docker

```bash
docker pull ghcr.io/sahina/ironflow-releases:latest
docker run -p 9123:9123 ghcr.io/sahina/ironflow-releases:latest serve
```

### Direct binary

Grab the version tag from the [latest release](https://github.com/sahina/ironflow-releases/releases/latest)
and substitute it below.

```bash
VERSION=<LATEST_VERSION>   # e.g. v1.2.3, from the releases page
BASE="https://github.com/sahina/ironflow-releases/releases/download/${VERSION}"

curl -L -o ironflow.tar.gz        "${BASE}/ironflow_${VERSION#v}_linux_amd64.tar.gz"
curl -L -o ironflow.tar.gz.bundle "${BASE}/ironflow_${VERSION#v}_linux_amd64.tar.gz.bundle"

tar xzf ironflow.tar.gz
./ironflow serve
```

Swap `linux_amd64` for `linux_arm64`, `darwin_amd64`, `darwin_arm64` (all `.tar.gz`), or
`windows_amd64` / `windows_arm64` (`.zip`).

### Kubernetes (Helm)

```bash
helm install ironflow oci://ghcr.io/sahina/charts/ironflow --version <chart-version>
```

See the [Helm chart guide](https://docs.ironflow.run/how-to-guides/deployment/helm-chart/).

## What's in a release

| Asset | Purpose |
| --- | --- |
| `ironflow_<version>_<os>_<arch>.tar.gz` / `.zip` | The engine binary |
| `ironflow_<version>_<os>_<arch>.*.bundle` | Cosign signature bundle (new-bundle-format) |
| `ironflow_<version>_checksums.txt` | SHA-256 checksums for the artifact set |
| `ironflow-cloud_<version>_linux_amd64.tar.gz` | Ironflow Cloud control-plane binary — not needed for self-hosting |

Container images are published separately to `ghcr.io/sahina/ironflow-releases`.

## Verifying a release

Every binary and image is signed with [Sigstore cosign keyless](https://docs.sigstore.dev/quickstart/quickstart-cosign/).

Verify a binary:

```bash
VERSION=<LATEST_VERSION>   # without the leading v — e.g. 1.2.3
cosign verify-blob \
  --certificate-identity-regexp '^https://github\.com/sahina/ironflow/\.github/workflows/release\.yml@(refs/heads/main|refs/tags/v.*)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --new-bundle-format \
  --bundle "ironflow_${VERSION}_linux_amd64.tar.gz.bundle" \
  "ironflow_${VERSION}_linux_amd64.tar.gz"
```

Verify the container image:

```bash
cosign verify ghcr.io/sahina/ironflow-releases:latest \
  --certificate-identity-regexp '^https://github\.com/sahina/ironflow/\.github/workflows/release\.yml@(refs/heads/main|refs/tags/v.*)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

Or check the hashes:

```bash
sha256sum -c ironflow_${VERSION}_checksums.txt --ignore-missing
```

## Related repositories

| Repo | What it is |
| --- | --- |
| [ironflow-desktop-releases](https://github.com/sahina/ironflow-desktop-releases) | Ironflow Desktop downloads |
| [ironflow-js](https://github.com/sahina/ironflow-js) | Public source mirror for the `@ironflow/*` npm packages |
| [ironflow-go](https://github.com/sahina/ironflow-go) | Public source mirror for the Go SDK |
| [homebrew-tap](https://github.com/sahina/homebrew-tap) | Homebrew formula (`brew tap sahina/tap`) |
| [ironflow-issues](https://github.com/sahina/ironflow-issues) | Public issue tracker — bugs and feature requests |

## Bugs & support

File issues at <https://github.com/sahina/ironflow-issues/issues/new/choose>. Issues are disabled
on this repo so everything lands in one place.

Security disclosures go to
[private advisories](https://github.com/sahina/ironflow-issues/security/advisories/new), never a
public issue. Commercial-licensing enquiries: <https://ironflow.run>.

## License

Ironflow ships under the Functional Source License v1.1 with an Apache-2.0 future grant —
SPDX `LicenseRef-Ironflow-EULA`. Free for development, evaluation, personal projects, internal
non-revenue tooling, education, and non-commercial research. A commercial license is required for
externally-facing production or commercial product features.

Terms: [LICENSE](LICENSE) · Plain-English worked examples: <https://docs.ironflow.run/explanation/licensing/>
