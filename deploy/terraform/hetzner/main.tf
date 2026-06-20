terraform {
  required_version = ">= 1.9.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.60.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

module "kubernetes" {
  source  = "hcloud-k8s/kubernetes/hcloud"
  version = "3.30.2"

  cluster_name = var.cluster_name
  hcloud_token = var.hcloud_token

  # Default 10 retries (100s) is insufficient for Hetzner boot times.
  # 30 retries (300s) gives nodes enough time to complete TLS bootstrap.
  talosctl_retries = 30

  # Write kubeconfig and talosconfig to the current directory
  cluster_kubeconfig_path  = "kubeconfig"
  cluster_talosconfig_path = "talosconfig"

  # Batteries included
  cert_manager_enabled = true

  # Allow NodePort traffic from the private network so Hetzner Load Balancers
  # (which route via private IP) can reach Kubernetes NodePort services and
  # pass health checks.
  firewall_extra_rules = var.enable_lb ? [
    {
      description = "Allow LB to NodePort (TCP) via private network"
      direction   = "in"
      protocol    = "tcp"
      port        = "30000-32767"
      source_ips  = ["10.0.0.0/8"]
    }
  ] : []

  # Node pools
  control_plane_nodepools = [
    {
      name     = "control"
      type     = var.control_plane_type
      location = var.location
      count    = var.control_plane_count
    }
  ]

  worker_nodepools = [
    {
      name     = "worker"
      type     = var.worker_type
      location = var.location
      count    = var.worker_count
    }
  ]
}
