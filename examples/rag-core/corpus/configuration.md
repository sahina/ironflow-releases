# Configuring Forge

All configuration lives in `forge.yaml` at the project root.

## Output directory

The `output` key sets the build directory. The default is `dist/`.

## Environments

Define environments under the `envs` key. Each environment can override
`baseUrl` and `output`. Select one with `forge build --env staging`.

## Plugins

List plugins under the `plugins` key. Forge loads them in order. A plugin
that fails to load stops the build with exit code 3.
