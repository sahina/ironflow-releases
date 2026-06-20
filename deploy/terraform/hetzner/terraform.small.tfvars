# Small cluster — 1 control plane + 1 worker
# Recommended for: Small deployment template (dev, staging, small teams)
#
# Usage:
#   ironflow provision create --provider hetzner --template small --name demo
#   Or: terraform apply -var-file=terraform.small.tfvars -var=cluster_name=demo
#
# Note: cluster_name is provided via --name flag (not set here)

location            = "fsn1"

control_plane_type  = "cpx22"    # 3 vCPU, 4GB RAM
control_plane_count = 1

worker_type         = "cpx32"    # 4 vCPU, 8GB RAM
worker_count        = 1
