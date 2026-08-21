# Getting started with Forge

Forge is a command-line tool that builds and serves static sites.

## Install

Install Forge with Homebrew: `brew install forgecli`. Forge needs Node.js 20
or newer.

## Your first site

Run `forge new my-site` to scaffold a project. The scaffold contains a
`site/` folder for pages and a `forge.yaml` config file.

## The dev server

Run `forge dev` to start the local server. By default it listens on port
4311. Pass `--port` to change it. The dev server rebuilds pages when a file
changes.
