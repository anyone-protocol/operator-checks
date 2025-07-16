job "operator-checks-redis-sentinel-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  group "operator-checks-redis-sentinel-live-group" {
    count = 1

    network {
      mode = "bridge"
      port "redis-master" {
        static = 6379
        host_network = "wireguard"
      }
      port "redis-replica-1" {
        static = 6380
        host_network = "wireguard"
      }
      port "redis-replica-2" {
        static = 6381
        host_network = "wireguard"
      }
      port "sentinel-1" {
        static = 26379
        host_network = "wireguard"
      }
      port "sentinel-2" {
        static = 26380
        host_network = "wireguard"
      }
      port "sentinel-3" {
        static = 26381
        host_network = "wireguard"
      }
    }

    volume "operator-checks-redis-sentinel-live-master-data" {
      type      = "host"
      source    = "operator-checks-redis-sentinel-live-master-data"
      read_only = false
    }

    volume "operator-checks-redis-sentinel-live-replica-1-data" {
      type      = "host"
      source    = "operator-checks-redis-sentinel-live-replica-1-data"
      read_only = false
    }

    volume "operator-checks-redis-sentinel-live-replica-2-data" {
      type      = "host"
      source    = "operator-checks-redis-sentinel-live-replica-2-data"
      read_only = false
    }

    task "operator-checks-redis-sentinel-live-redis-master-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-master"]

        args = [
          "redis-server",
          "--port", "6379",
          "--appendonly", "yes",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_master}",
          "--replica-announce-port", "${NOMAD_PORT_redis_master}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      volume_mount {
        volume      = "operator-checks-redis-sentinel-live-master-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 2048
      }
    }

    task "operator-checks-redis-sentinel-live-redis-replica-1-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-replica-1"]

        args = [
          "redis-server",
          "--port", "6380",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_1}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_1}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      volume_mount {
        volume      = "operator-checks-redis-sentinel-live-replica-1-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "operator-checks-redis-sentinel-live-redis-replica-2-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-replica-2"]

        args = [
          "redis-server",
          "--port", "6381",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_2}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_2}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      volume_mount {
        volume      = "operator-checks-redis-sentinel-live-replica-2-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "operator-checks-redis-sentinel-live-sentinel-1-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor operator-checks-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds operator-checks-live-redis-master 10000
        sentinel failover-timeout operator-checks-live-redis-master 10000
        sentinel parallel-syncs operator-checks-live-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-1"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "26379"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "operator-checks-redis-sentinel-live-sentinel-2-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor operator-checks-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds operator-checks-live-redis-master 10000
        sentinel failover-timeout operator-checks-live-redis-master 10000
        sentinel parallel-syncs operator-checks-live-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-2"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "26380"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "operator-checks-redis-sentinel-live-sentinel-3-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor operator-checks-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds operator-checks-live-redis-master 10000
        sentinel failover-timeout operator-checks-live-redis-master 10000
        sentinel parallel-syncs operator-checks-live-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-3"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "26381"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    service {
      name = "operator-checks-live-redis-master"
      port = "redis-master"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "operator-checks-live-redis-replica-1"
      port = "redis-replica-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "operator-checks-live-redis-replica-2"
      port = "redis-replica-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "operator-checks-live-sentinel-1"
      port = "sentinel-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "operator-checks-live-sentinel-2"
      port = "sentinel-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "operator-checks-live-sentinel-3"
      port = "sentinel-3"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }
  }
}
