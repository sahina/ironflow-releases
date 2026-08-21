# Troubleshooting Forge

## Port already in use

If `forge dev` reports the port is busy, another process holds port 4311.
Stop it, or start Forge with `forge dev --port 4400`.

## Build exits with code 3

Exit code 3 means a plugin failed to load. Run `forge build --verbose` to
see which plugin, then remove it from `forge.yaml` or update it.

## Stale pages

If pages look stale, delete the `.forge-cache/` folder and rebuild. The
cache is safe to delete at any time.
