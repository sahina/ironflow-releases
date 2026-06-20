variable "hcloud_token" {
  description = "Hetzner Cloud API token (Read & Write)"
  type        = string
  sensitive   = true
}

variable "cluster_name" {
  description = "Name of the Kubernetes cluster"
  type        = string
  default     = "ironflow"
}

variable "location" {
  description = "Hetzner datacenter location (fsn1, nbg1, hel1)"
  type        = string
  default     = "fsn1"
}

variable "control_plane_type" {
  description = "Server type for control plane nodes"
  type        = string
  default     = "cpx22"
}

variable "control_plane_count" {
  description = "Number of control plane nodes (must be odd: 1 or 3)"
  type        = number
  default     = 3

  validation {
    condition     = var.control_plane_count % 2 == 1
    error_message = "control_plane_count must be odd (1, 3, or 5) for etcd quorum."
  }
}

variable "worker_type" {
  description = "Server type for worker nodes"
  type        = string
  default     = "cpx32"
}

variable "worker_count" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}

variable "enable_lb" {
  description = "Open NodePort range (30000-32767) on the private network for Hetzner Load Balancer health checks and traffic routing"
  type        = bool
  default     = false
}
