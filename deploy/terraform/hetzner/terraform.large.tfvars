# Large cluster — 3 control plane + 2 workers
# Recommended for: Large deployment template (enterprise, external deps)
#
# Usage:
#   ironflow provision create --provider hetzner --template large --name prod
#   Or: terraform apply -var-file=terraform.large.tfvars -var=cluster_name=prod
#
# Note: cluster_name is provided via --name flag (not set here)

location            = "fsn1"

control_plane_type  = "cpx22"    # 3 vCPU, 4GB RAM
control_plane_count = 3

worker_type         = "cpx32"    # 4 vCPU, 8GB RAM
worker_count        = 2
