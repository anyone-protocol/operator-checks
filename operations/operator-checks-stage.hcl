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
        image = "ghcr.io/anyone-protocol/operator-checks:[[ .commit_sha ]]"
      }

      env {
        IS_LIVE="true"
        VERSION="[[ .commit_sha ]]"
		    PORT="${NOMAD_PORT_http}"
        REDIS_MODE="sentinel"
        REDIS_MASTER_NAME="operator-checks-stage-redis-master"
        AO_BALANCE_CHECKS_ENABLED="false"
        HODLER_OPERATOR_MIN_ETH="1"
        HODLER_OPERATOR_MAX_ETH="5"
        REWARDS_POOL_MIN_TOKEN=100000
        REWARDS_POOL_MAX_TOKEN=250000
        BUNDLER_MIN_AR=1
        BUNDLER_MAX_AR=2
        OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE=100
        OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE=1000
        RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE=100
        RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE=1000
        STAKING_REWARDS_OPERATOR_MIN_AO_BALANCE=100
        STAKING_REWARDS_OPERATOR_MAX_AO_BALANCE=1000
        TURBO_DEPLOYER_MIN_CREDITS=0.5
        TURBO_DEPLOYER_MAX_CREDITS=2
        TURBO_RELAY_REWARDS_MIN_CREDITS=0.5
        TURBO_RELAY_REWARDS_MAX_CREDITS=2
        TURBO_STAKING_REWARDS_MIN_CREDITS=0.5
        TURBO_STAKING_REWARDS_MAX_CREDITS=2
        AO_TOKEN_PROCESS_ID="0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc"
        IS_LOCAL_LEADER="true"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        CONSUL_SERVICE_NAME="operator-checks-stage"
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      template {
        data = <<-EOH
        {{- with secret "kv/stage-protocol/operator-checks-stage" }}
        AR_SPENDER_KEY={{ base64Decode .Data.data.AR_SPENDER_KEY_BASE64 | toJSON }}
        BUNDLER_OPERATOR_JWK={{ base64Decode .Data.data.BUNDLER_KEY_BASE64 | toJSON }}
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
