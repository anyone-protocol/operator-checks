variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
  default     = "a170203b2e347852c9cd23066ebe3517a6295cf8"
}

job "operator-checks-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "operator-checks-stage-group" {
    count = 2

    update {
      max_parallel     = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
    }

    network {
      port "http" {
        host_network = "wireguard"
      }
    }

    task "operator-checks-stage-service" {
      kill_timeout = "30s"
      driver = "docker"
      config {
        network_mode = "host"
        image = "ghcr.io/anyone-protocol/operator-checks:${var.commit_sha}"
      }

      env {
        IS_LIVE="true"
        VERSION = var.commit_sha
		    PORT="${NOMAD_PORT_http}"
        REDIS_MODE="sentinel"
        REDIS_MASTER_NAME="operator-checks-stage-redis-master"
        HODLER_OPERATOR_MIN_ETH="1"
        HODLER_OPERATOR_MAX_ETH="5"
        REWARDS_POOL_MIN_TOKEN=100000
        REWARDS_POOL_MAX_TOKEN=250000
        HYPERBEAM_NODE_AR_ADDRESS="EbD49sHTtVM3POcTmJBHBvuVzVJjwY6_rW2y0WvWPK0"
        PUBLISHING_LAG_ALERT_MS="1800000"
        CHECKPOINT_MAX_AGE_MS="172800000"
        # NB: goldsky serves GraphQL but 404s on /<id>, so it is an INDEX only, never a data gateway.
        PUBLIC_ARWEAVE_GATEWAYS="https://arweave.net"
        PUBLIC_ARWEAVE_INDEXES="https://arweave.net,https://arweave-search.goldsky.com"
        HYPERBEAM_NODE_MIN_AR=3
        HYPERBEAM_NODE_MAX_AR=6
        IS_LOCAL_LEADER="true"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        CONSUL_SERVICE_NAME="operator-checks-stage"
        RECHECK_DELAY_MS="900000"
      }

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/stage-protocol/operator-checks-stage" }}
        AR_SPENDER_KEY={{ base64Decode .Data.data.AR_SPENDER_KEY_BASE64 | toJSON }}
        CONSUL_TOKEN_CONTROLLER_CLUSTER="{{.Data.data.CONSUL_TOKEN_CONTROLLER_CLUSTER}}"
        ETH_SPENDER_KEY="{{ .Data.data.ETH_SPENDER_KEY }}"
        HODLER_OPERATOR_ADDRESS="{{ .Data.data.HODLER_OPERATOR_ADDRESS }}"
        JSON_RPC="{{.Data.data.JSON_RPC}}"
        REWARDS_POOL_ADDRESS="{{ .Data.data.REWARDS_POOL_ADDRESS }}"
        {{- end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}

      template {
        data = <<-EOH
        TOKEN_CONTRACT_ADDRESS="{{ key "ator-token/sepolia/stage/address" }}"
        {{- range service "validator-stage-mongo|any" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-stage"
        {{- end }}
        {{- range service "hyperbeam-stage-node|any" }}
        HYPERBEAM_NODE_URL="http://{{ .Address }}:{{ .Port }}"
        {{- end }}
        {{- range service "ario-any1-envoy|any" }}
        ARWEAVE_GATEWAY_PROTOCOL="http"
        ARWEAVE_GATEWAY_HOST="{{ .Address }}"
        ARWEAVE_GATEWAY_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-redis-master|any" }}
        REDIS_MASTER_NAME="{{ .Name }}"
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-1|any" }}
        REDIS_SENTINEL_1_HOST={{ .Address }}
        REDIS_SENTINEL_1_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-2|any" }}
        REDIS_SENTINEL_2_HOST={{ .Address }}
        REDIS_SENTINEL_2_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-3|any" }}
        REDIS_SENTINEL_3_HOST={{ .Address }}
        REDIS_SENTINEL_3_PORT={{ .Port }}
        {{- end }}
        EOH
        destination = "local/config.env"
        env         = true
        wait {
          min = "30s"
          max = "90s"
        }
      }

      resources {
        cpu    = 2048
        memory = 2048
      }

      service {
        name = "operator-checks-stage"
        port = "http"
        tags = ["logging"]
        check {
          name     = "operator-checks-stage health check"
          type     = "http"
          path     = "/health"
          interval = "5s"
          timeout  = "10s"
          check_restart {
            limit = 180
            grace = "15s"
          }
        }
      }
    }
  }
}
