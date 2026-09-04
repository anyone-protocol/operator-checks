variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
  // Pinned so the jobspec can be run by hand without passing -var. The release workflow no
  // longer deploys on push, so nothing substitutes this for us any more; bump it deliberately
  // when promoting a build, and override with -var=commit_sha=... for a one-off.
  default     = "93fe6c69a3ad8fc463286bb5a03b909a0ceb7cc2"
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
        # The hyperbeam node's own wallet. Since the nodes self-bundle it pays for EVERY
        # assignment and message, and an empty one stops publishing SILENTLY - the scheduler
        # discards the upload result, so slots keep advancing and become unpublishable.
        # Measured burn 0.328 AR/day (stage) on 2026-09-03, so min is ~10 days of warning and
        # max ~30 days of runway. Address only: the node's key never leaves the node.
        # ⚠️ QUOTED. Unquoted, HCL2 reads a bare word as a variable reference and Nomad
        # preserves unresolvable ones as a literal "${...}" for runtime interpolation, so the
        # service received the address wrapped in braces and every balance read 400d.
        HYPERBEAM_NODE_AR_ADDRESS="EbD49sHTtVM3POcTmJBHBvuVzVJjwY6_rW2y0WvWPK0"
        # MIN/MAX are sized against the AR_SPENDER wallet, not just the node's runway. A refill
        # sends (MAX - balance), and sendArTo compares balance < amount WITHOUT the tx fee, so a
        # MAX close to the spender's balance can pass the check and still fail on chain. The
        # spenders held ~11-16 AR after the 2026-09-03 top-up, so MAX=6 leaves room for about two
        # refills before they need attention. At 0.328 AR/day a 3 AR top-up is ~9 days of runway of node runway.
        # D25 publishing reliability. Lag is measured as the AGE of the newest published
        # assignment, so 1800000 = 3 bundler flush cycles, not 3 slots.
        PUBLISHING_LAG_ALERT_MS="1800000"
        CHECKPOINT_MAX_AGE_MS="172800000"
        # goldsky serves GraphQL but 404s on /<id>, so it is an INDEX only, never a data gateway.
        PUBLIC_ARWEAVE_GATEWAYS="https://arweave.net"
        PUBLIC_ARWEAVE_INDEXES="https://arweave.net,https://arweave-search.goldsky.com"
        HYPERBEAM_NODE_MIN_AR=3
        HYPERBEAM_NODE_MAX_AR=6
        IS_LOCAL_LEADER="true"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        CONSUL_SERVICE_NAME="operator-checks-stage"
        RECHECK_DELAY_MS="900000" # 15 minutes
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

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
        {{- range service "validator-stage-mongo" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-stage"
        {{- end }}
        {{- range service "hyperbeam-stage-node" }}
        HYPERBEAM_NODE_URL="http://{{ .Address }}:{{ .Port }}"
        {{- end }}
        {{- range service "ario-any1-envoy" }}
        ARWEAVE_GATEWAY_PROTOCOL="http"
        ARWEAVE_GATEWAY_HOST="{{ .Address }}"
        ARWEAVE_GATEWAY_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-redis-master" }}
        REDIS_MASTER_NAME="{{ .Name }}"
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-1" }}
        REDIS_SENTINEL_1_HOST={{ .Address }}
        REDIS_SENTINEL_1_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-2" }}
        REDIS_SENTINEL_2_HOST={{ .Address }}
        REDIS_SENTINEL_2_PORT={{ .Port }}
        {{- end }}
        {{- range service "operator-checks-stage-sentinel-3" }}
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
