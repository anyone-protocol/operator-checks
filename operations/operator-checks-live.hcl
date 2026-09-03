variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
  // Pinned so the jobspec can be run by hand without passing -var. The release workflow no
  // longer deploys on push, so nothing substitutes this for us any more; bump it deliberately
  // when promoting a build, and override with -var=commit_sha=... for a one-off.
  default     = "68da50e3ff5aa10af4cc6a161aaf138985bf9bbe"
}

job "operator-checks-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  group "operator-checks-live-group" {
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

    task "operator-checks-live-service" {
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
        REDIS_MASTER_NAME="operator-checks-live-redis-master"
        HODLER_OPERATOR_MIN_ETH="0.01"
        HODLER_OPERATOR_MAX_ETH="0.1"
        REWARDS_POOL_MIN_TOKEN=50000
        REWARDS_POOL_MAX_TOKEN=100000
        # The hyperbeam node's own wallet. Since the nodes self-bundle it pays for EVERY
        # assignment and message, and an empty one stops publishing SILENTLY - the scheduler
        # discards the upload result, so slots keep advancing and become unpublishable.
        # Measured burn 0.238 AR/day (live) on 2026-09-03, so min is ~10 days of warning and
        # max ~30 days of runway. Address only: the node's key never leaves the node.
        # ⚠️ QUOTED. Unquoted, HCL2 reads a bare word as a variable reference and Nomad
        # preserves unresolvable ones as a literal "${...}" for runtime interpolation, so the
        # service received the address wrapped in braces and every balance read 400d.
        HYPERBEAM_NODE_AR_ADDRESS="g2O4uQd12vfv0JJPbdz7Vi9eNcGKdZuFXBlBS96MrCQ"
        # MIN/MAX are sized against the AR_SPENDER wallet, not just the node's runway. A refill
        # sends (MAX - balance), and sendArTo compares balance < amount WITHOUT the tx fee, so a
        # MAX close to the spender's balance can pass the check and still fail on chain. The
        # spenders held ~11-16 AR after the 2026-09-03 top-up, so MAX=6 leaves room for about two
        # refills before they need attention. At 0.238 AR/day a 3 AR top-up is ~12 days of runway of node runway.
        HYPERBEAM_NODE_MIN_AR=3
        HYPERBEAM_NODE_MAX_AR=6
        TURBO_DEPLOYER_MIN_CREDITS=0.5
        TURBO_DEPLOYER_MAX_CREDITS=2
        TURBO_OPERATOR_REGISTRY_MIN_CREDITS=0.5
        TURBO_OPERATOR_REGISTRY_MAX_CREDITS=2
        TURBO_RELAY_REWARDS_MIN_CREDITS=0.5
        TURBO_RELAY_REWARDS_MAX_CREDITS=2
        TURBO_STAKING_REWARDS_MIN_CREDITS=0.5
        TURBO_STAKING_REWARDS_MAX_CREDITS=2
        IS_LOCAL_LEADER="true"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        CONSUL_SERVICE_NAME="operator-checks-live"
        RECHECK_DELAY_MS="900000" # 15 minutes
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      template {
        data = <<-EOH
        {{- with secret "kv/live-protocol/operator-checks-live" }}
        AR_SPENDER_KEY={{ base64Decode .Data.data.AR_SPENDER_KEY_BASE64 | toJSON }}
        CONSUL_TOKEN_CONTROLLER_CLUSTER="{{.Data.data.CONSUL_TOKEN_CONTROLLER_CLUSTER}}"
        ETH_SPENDER_KEY="{{ .Data.data.ETH_SPENDER_KEY }}"
        HODLER_OPERATOR_ADDRESS="{{ .Data.data.HODLER_OPERATOR_ADDRESS }}"
        JSON_RPC="{{.Data.data.JSON_RPC}}"
        OPERATOR_REGISTRY_CONTROLLER_ADDRESS="{{ .Data.data.OPERATOR_REGISTRY_CONTROLLER_ADDRESS }}"
        RELAY_REWARDS_CONTROLLER_ADDRESS="{{ .Data.data.RELAY_REWARDS_CONTROLLER_ADDRESS }}"
        REWARDS_POOL_ADDRESS="{{ .Data.data.REWARDS_POOL_ADDRESS }}"
        STAKING_REWARDS_CONTROLLER_ADDRESS="{{ .Data.data.STAKING_REWARDS_CONTROLLER_ADDRESS }}"
        TURBO_DEPLOYER_ADDRESS="{{ .Data.data.TURBO_DEPLOYER_ADDRESS }}"
        {{- end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}

      template {
        data = <<-EOH
        TOKEN_CONTRACT_ADDRESS="{{ key "ator-token/ethereum/live/address" }}"
        {{- range service "validator-live-mongo" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-live-ethereum"
        {{- end }}
        {{- range service "ario-any1-envoy" }}
        ARWEAVE_GATEWAY_PROTOCOL="http"
        ARWEAVE_GATEWAY_HOST="{{ .Address }}"
        ARWEAVE_GATEWAY_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-live-redis-master" }}
        REDIS_MASTER_NAME="{{ .Name }}"
        {{- end }}
        {{- range service "operator-checks-live-sentinel-1" }}
        REDIS_SENTINEL_1_HOST={{ .Address }}
        REDIS_SENTINEL_1_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-live-sentinel-2" }}
        REDIS_SENTINEL_2_HOST={{ .Address }}
        REDIS_SENTINEL_2_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-live-sentinel-3" }}
        REDIS_SENTINEL_3_HOST={{ .Address }}
        REDIS_SENTINEL_3_PORT={{ .Port }}
        {{- end }}
        EOH
        destination = "local/config.env"
        env         = true
      }

      resources {
        cpu    = 2048
        memory = 2048
      }

      service {
        name = "operator-checks-live"
        port = "http"
        tags = ["logging"]
        check {
          name     = "operator-checks-live health check"
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
