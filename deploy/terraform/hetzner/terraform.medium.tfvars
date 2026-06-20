# Medium cluster — 3 control plane + 1 worker
# Recommended for: Medium deployment template (production HA)
#
# Usage:
#   ironflow provision create --provider hetzner --template medium --name staging
#   Or: terraform apply -var-file=terraform.medium.tfvars -var=cluster_name=staging
#
# Note: cluster_name is provided via --name flag (not set here)

location            = "fsn1"

control_plane_type  = "cpx22"    # 3 vCPU, 4GB RAM
control_plane_count = 3

worker_type         = "cpx22"    # 3 vCPU, 4GB RAM
worker_count        = 2
