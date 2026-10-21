#!/bin/sh
# Writes .env next to this script from .env.example, with random values for
# every required key. It never overwrites an existing .env: that file holds
# the master key, the only way to read secrets the stack already stored.
set -eu

dir=$(cd "$(dirname "$0")" && pwd)
env="$dir/.env"
if [ -e "$env" ]; then
	echo "init-env.sh: $env already exists; not changed." >&2
	echo "To upgrade an existing stack, add any missing keys to it by hand (see .env.example)." >&2
	echo "Keep your POSTGRES_PASSWORD; a stack started before init-env.sh existed used 'ironflow'." >&2
	exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
	echo "init-env.sh: openssl is required to generate keys." >&2
	exit 1
fi

admin="ifkey_$(openssl rand -hex 16)"
password="$(openssl rand -hex 16)"
tmp="$env.tmp.$$"
trap 'rm -f "$tmp"' EXIT
umask 077
sed \
	-e "s|^IRONFLOW_MASTER_KEY=\$|IRONFLOW_MASTER_KEY=$(openssl rand -hex 32)|" \
	-e "s|^IRONFLOW_JWT_SECRET=\$|IRONFLOW_JWT_SECRET=$(openssl rand -hex 32)|" \
	-e "s|^POSTGRES_PASSWORD=\$|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
	-e "s|^POSTGRES_SUPERUSER_PASSWORD=\$|POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -hex 24)|" \
	-e "s|^POSTGRES_REPLICATION_PASSWORD=\$|POSTGRES_REPLICATION_PASSWORD=$(openssl rand -hex 24)|" \
	-e "s|^S3_ACCESS_KEY=\$|S3_ACCESS_KEY=$(openssl rand -hex 10)|" \
	-e "s|^S3_SECRET_KEY=\$|S3_SECRET_KEY=$(openssl rand -hex 20)|" \
	-e "s|^IRONFLOW_BOOTSTRAP_ADMIN_KEY=\$|IRONFLOW_BOOTSTRAP_ADMIN_KEY=$admin|" \
	-e "s|^IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD=\$|IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD=$password|" \
	"$dir/.env.example" >"$tmp"
for key in IRONFLOW_MASTER_KEY IRONFLOW_JWT_SECRET POSTGRES_PASSWORD POSTGRES_SUPERUSER_PASSWORD POSTGRES_REPLICATION_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY IRONFLOW_BOOTSTRAP_ADMIN_KEY IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD; do
	if ! grep -q "^$key=." "$tmp"; then
		echo "init-env.sh: .env.example has no empty $key= line to fill." >&2
		exit 1
	fi
done
mv "$tmp" "$env"

echo "Wrote $env"
echo "Admin API key:      $admin"
echo "Dashboard login:    admin@ironflow.local / $password"
echo "Keep a copy of .env. Without IRONFLOW_MASTER_KEY, stored secrets cannot be read."
