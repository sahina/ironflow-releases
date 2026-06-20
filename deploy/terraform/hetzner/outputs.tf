output "cluster_name" {
  description = "Name of the Kubernetes cluster"
  value       = var.cluster_name
}

output "kubeconfig_path" {
  description = "Path to the kubeconfig file"
  value       = "kubeconfig"
}

output "talosconfig_path" {
  description = "Path to the talosconfig file"
  value       = "talosconfig"
}

output "cluster_info" {
  description = "Cluster summary"
  value = {
    name              = var.cluster_name
    location          = var.location
    control_plane     = "${var.control_plane_count}x ${var.control_plane_type}"
    workers           = "${var.worker_count}x ${var.worker_type}"
  }
}
