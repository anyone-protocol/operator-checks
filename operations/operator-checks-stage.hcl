job "operator-checks-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "operator-checks-stage-group" {
    count = 1

    update {
      max_parallel     = 1
      canary           = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
      auto_promote     = true
    }

    network {
      mode = "bridge"
      port "operator-checks" {
        to = 3000
        host_network = "wireguard"
      }
      port "redis" {
        host_network = "wireguard"
      }
    }

    task "operator-checks-stage-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/operator-checks:[[ .commit_sha ]]"
      }

      env {
        IS_LIVE="true"
        VERSION="[[ .commit_sha ]]"
        REDIS_MODE="sentinel"
        REDIS_MASTER_NAME="operator-checks-stage-redis-master"
        RELAY_REGISTRY_OPERATOR_MIN_BALANCE=1000000
        RELAY_REGISTRY_OPERATOR_MAX_BALANCE=100000000
        DISTRIBUTION_OPERATOR_MIN_BALANCE=3000000
        DISTRIBUTION_OPERATOR_MAX_BALANCE=300000000
        FACILITY_OPERATOR_MIN_ETH=1
        FACILITY_OPERATOR_MAX_ETH=5
        FACILITY_CONTRACT_MIN_TOKEN=10000
        FACILITY_CONTRACT_MAX_TOKEN=100000
        HODLER_OPERATOR_MIN_ETH=1
        HODLER_OPERATOR_MAX_ETH=5
        HODLER_CONTRACT_MIN_TOKEN=10000
        HODLER_CONTRACT_MAX_TOKEN=100000
        REWARDS_POOL_MIN_TOKEN=100000
        REWARDS_POOL_MAX_TOKEN=250000
        BUNDLER_MIN_AR=1
        BUNDLER_MAX_AR=2
        OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE=100
        OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE=1000
        RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE=100
        RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE=1000
        AO_TOKEN_PROCESS_ID="Pi-WmAQp2-mh-oWH9lWpz5EthlUDj_W0IusAv-RXhRk"
        BUNDLER_NODE="https://node2.irys.xyz"
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      identity {
        name = "vault_default"
        aud  = ["any1-infra"]
        ttl  = "1h"
      }

      template {
        data = <<-EOH
        {{with secret "kv/stage-protocol/operator-checks-stage"}}
        RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_CONTROLLER_KEY}}"
        DISTRIBUTION_OPERATOR_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY_DEPRECATED}}"
        FACILITY_OPERATOR_KEY="{{.Data.data.FACILITY_OPERATOR_KEY_DEPRECATED}}"
        HODLER_OPERATOR_KEY="{{ .Data.data.HODLER_OPERATOR_KEY_DEPRECATED }}"
        REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY_DEPRECATED}}"
        JSON_RPC="{{.Data.data.JSON_RPC}}"
        INFURA_NETWORK="{{.Data.data.INFURA_NETWORK}}"
        INFURA_WS_URL="{{.Data.data.INFURA_WS_URL}}"
        BUNDLER_NETWORK="{{.Data.data.BUNDLER_NETWORK}}"
        ETH_SPENDER_KEY="{{.Data.data.ETH_SPENDER_KEY}}"
        AR_SPENDER_KEY={{ base64Decode .Data.data.AR_SPENDER_KEY_BASE64 | toJSON }}
        BUNDLER_OPERATOR_JWK={{ base64Decode .Data.data.BUNDLER_KEY_BASE64 | toJSON }}
        REWARDS_POOL_ADDRESS="{{ .Data.data.REWARDS_POOL_ADDRESS }}"
        {{end}}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      template {
        data = <<-EOH
        RELAY_REGISTRY_CONTRACT_TXID="{{ key "smart-contracts/stage/relay-registry-address" }}"
        DISTRIBUTION_CONTRACT_TXID="{{ key "smart-contracts/stage/distribution-address" }}"
        FACILITY_CONTRACT_ADDRESS="{{ key "facilitator/sepolia/stage/address" }}"
        HODLER_CONTRACT_ADDRESS="{{ key "hodler/sepolia/stage/address" }}"
        REGISTRATOR_CONTRACT_ADDRESS="{{ key "registrator/sepolia/stage/address" }}"
        TOKEN_CONTRACT_ADDRESS="{{ key "ator-token/sepolia/stage/address" }}"
        {{- range service "validator-stage-mongo" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-stage"
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
        port = "operator-checks"
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
