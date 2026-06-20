#!/usr/bin/env bash
# deploy/terraform/hetzner/teardown.sh
# Tear down the Hetzner cluster and all resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -z "${HCLOUD_TOKEN:-}" ]; then
  echo "Error: HCLOUD_TOKEN environment variable is not set."
  echo "Run: export HCLOUD_TOKEN=your-token-here"
  exit 1
fi

if ! command -v hcloud >/dev/null 2>&1; then
  echo "Error: hcloud CLI is required for teardown (handles delete-protected resources)."
  echo "Install: brew install hcloud"
  exit 1
fi

export HCLOUD_TOKEN

CLUSTER_NAME="${1:-ironflow}"

# Validate cluster name contains only safe characters (alphanumeric, hyphen, underscore)
# to prevent regex metacharacters from matching unintended resources in grep patterns.
if ! echo "$CLUSTER_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  echo "Error: Cluster name '${CLUSTER_NAME}' contains invalid characters."
  echo "Only alphanumeric characters, hyphens, and underscores are allowed."
  exit 1
fi

echo "=== Ironflow Cluster Teardown ==="
echo ""
echo "This will DESTROY all cluster resources on Hetzner Cloud:"
echo "  - All Kubernetes nodes (VMs)"
echo "  - Load balancers, firewalls, networks"
echo "  - Hetzner Cloud Volumes (persistent data)"
echo ""

read -p "Type 'destroy' to confirm: " CONFIRM
if [ "$CONFIRM" != "destroy" ]; then
  echo "Aborted."
  exit 0
fi

echo ""

# Step 1: Try terraform destroy first (handles most resources)
echo "[1/3] Running terraform destroy..."
export TF_VAR_hcloud_token="$HCLOUD_TOKEN"
terraform init -input=false 2>/dev/null || true
# Remove prevent_destroy resource from state so destroy can proceed
terraform state rm 'module.kubernetes.talos_machine_secrets.this' 2>/dev/null || true
terraform destroy -auto-approve 2>&1 || true

# Step 2: Force-clean any remaining resources via hcloud CLI
# The terraform module enables delete protection on servers and networks,
# which can cause terraform destroy to fail. hcloud CLI handles this.
echo ""
echo "[2/3] Cleaning remaining Hetzner resources..."

# Servers
for server in $(hcloud server list -o noheader -o columns=name 2>/dev/null | grep "^${CLUSTER_NAME}-"); do
  echo "  Deleting server: $server"
  hcloud server disable-protection "$server" delete rebuild 2>/dev/null || true
  hcloud server delete "$server" 2>/dev/null || true
done

# Wait for servers to be fully deleted before cleaning volumes
sleep 5

# Volumes — labeled with cluster name
for vol_id in $(hcloud volume list -l "cluster=${CLUSTER_NAME}" -o noheader -o columns=id 2>/dev/null); do
  echo "  Deleting volume: $vol_id (labeled cluster=${CLUSTER_NAME})"
  hcloud volume detach "$vol_id" 2>/dev/null || true
  hcloud volume delete "$vol_id" 2>/dev/null || true
done
# Clean up PVC volumes without cluster labels (CSI-created).
# Only delete if attached to a non-existent server (orphaned after interrupted teardown).
# Unattached PVC volumes are only deleted if no other clusters exist in the project,
# since we can't determine which cluster they belonged to.
OTHER_SERVERS=$(hcloud server list -o noheader -o columns=name 2>/dev/null | grep -cv "^${CLUSTER_NAME}-" || true)
OTHER_SERVERS=${OTHER_SERVERS:-0}
for vol_id in $(hcloud volume list -o noheader -o columns=id 2>/dev/null); do
  VOL_NAME=$(hcloud volume describe "$vol_id" -o format='{{.Name}}' 2>/dev/null || true)
  if echo "$VOL_NAME" | grep -q "pvc-"; then
    VOL_SERVER=$(hcloud volume describe "$vol_id" -o format='{{.Server.ID}}' 2>/dev/null || true)
    if [ -z "$VOL_SERVER" ] || [ "$VOL_SERVER" = "0" ] || [ "$VOL_SERVER" = "<nil>" ]; then
      if [ "$OTHER_SERVERS" -eq 0 ]; then
        echo "  Deleting unattached PVC volume: $vol_id ($VOL_NAME)"
        hcloud volume delete "$vol_id" 2>/dev/null || true
      else
        echo "  Skipping unattached PVC volume: $vol_id ($VOL_NAME) (other clusters exist in project)"
      fi
    elif ! hcloud server describe "$VOL_SERVER" >/dev/null 2>&1; then
      echo "  Deleting orphaned PVC volume: $vol_id ($VOL_NAME) (server $VOL_SERVER no longer exists)"
      hcloud volume detach "$vol_id" 2>/dev/null || true
      hcloud volume delete "$vol_id" 2>/dev/null || true
    else
      echo "  Skipping PVC volume: $vol_id ($VOL_NAME) (attached to active server $VOL_SERVER)"
    fi
  fi
done

# Networks
for net in $(hcloud network list -o noheader -o columns=name 2>/dev/null | grep -E "^${CLUSTER_NAME}(-|$)"); do
  echo "  Deleting network: $net"
  hcloud network disable-protection "$net" delete 2>/dev/null || true
  hcloud network delete "$net" 2>/dev/null || true
done

# Firewalls
for fw in $(hcloud firewall list -o noheader -o columns=name 2>/dev/null | grep -E "^${CLUSTER_NAME}(-|$)"); do
  echo "  Deleting firewall: $fw"
  hcloud firewall delete "$fw" 2>/dev/null || true
done

# SSH keys
for key in $(hcloud ssh-key list -o noheader -o columns=name 2>/dev/null | grep -E "^${CLUSTER_NAME}(-|$)"); do
  echo "  Deleting SSH key: $key"
  hcloud ssh-key delete "$key" 2>/dev/null || true
done

# Load balancers — match by cluster name prefix OR by label (CCM-created LBs may not have cluster name prefix)
for lb in $(hcloud load-balancer list -o noheader -o columns=name 2>/dev/null | grep -E "^${CLUSTER_NAME}(-|$)"); do
  echo "  Deleting load balancer: $lb (name match)"
  hcloud load-balancer delete "$lb" 2>/dev/null || true
done
# CCM-created load balancers — only delete if all target servers are gone (orphaned).
# This protects LBs serving other clusters in the same Hetzner project.
for lb_id in $(hcloud load-balancer list -l 'hcloud-ccm/service-uid' -o noheader -o columns=id 2>/dev/null); do
  LB_NAME=$(hcloud load-balancer describe "$lb_id" -o format='{{.Name}}' 2>/dev/null || true)
  TARGET_SERVERS=$(hcloud load-balancer describe "$lb_id" -o format='{{range .Targets}}{{.Server.Server.ID}} {{end}}' 2>/dev/null || true)
  HAS_ACTIVE_TARGET=false
  for server_id in $TARGET_SERVERS; do
    if [ -n "$server_id" ] && [ "$server_id" != "0" ] && hcloud server describe "$server_id" >/dev/null 2>&1; then
      HAS_ACTIVE_TARGET=true
      break
    fi
  done
  if [ "$HAS_ACTIVE_TARGET" = false ]; then
    echo "  Deleting orphaned load balancer: $lb_id ($LB_NAME) (no active server targets)"
    hcloud load-balancer delete "$lb_id" 2>/dev/null || true
  else
    echo "  Skipping load balancer: $lb_id ($LB_NAME) (has active server targets)"
  fi
done

# Placement groups
for pg in $(hcloud placement-group list -o noheader -o columns=name 2>/dev/null | grep -E "^${CLUSTER_NAME}(-|$)"); do
  echo "  Deleting placement group: $pg"
  hcloud placement-group delete "$pg" 2>/dev/null || true
done

# Certificates (state marker used by the Terraform module to detect initialized clusters)
for cert in $(hcloud certificate list -o noheader -o columns=name 2>/dev/null | grep "^${CLUSTER_NAME}-"); do
  echo "  Deleting certificate: $cert"
  hcloud certificate delete "$cert" 2>/dev/null || true
done

# Step 3: Clean local files
echo ""
echo "[3/3] Cleaning local files..."
rm -f kubeconfig talosconfig talosconfig.yaml
rm -f terraform.tfstate terraform.tfstate.backup
rm -rf .terraform

echo ""
echo "=== Teardown Complete ==="

# Final verification
REMAINING=$(hcloud server list -o noheader -o columns=name 2>/dev/null | grep -c "^${CLUSTER_NAME}-" || true)
if [ "$REMAINING" -gt 0 ]; then
  echo "WARNING: $REMAINING ${CLUSTER_NAME} server(s) still exist. Check Hetzner Console."
  hcloud server list -o noheader -o columns=id,name,status | grep "^.*${CLUSTER_NAME}-"
else
  echo "All Hetzner resources destroyed. Billing stopped."
fi
