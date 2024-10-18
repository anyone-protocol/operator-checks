job "operator-checks-stage" {
  datacenters = ["ator-fin"]
  type = "service"

  group "operator-checks-stage-group" {
    
    count = 1

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
        image = "ghcr.io/anyone-protocol/operator-checks:[[.deploy]]"
      }

      env {
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        
        REDIS_HOSTNAME="localhost"
        REDIS_PORT="${NOMAD_PORT_redis}"

        RELAY_REGISTRY_OPERATOR_MIN_BALANCE=1000000
        RELAY_REGISTRY_OPERATOR_MAX_BALANCE=100000000
        RELAY_REGISTRY_UPLOADER_MIN_BALANCE=2000000
        RELAY_REGISTRY_UPLOADER_MAX_BALANCE=200000000
        DISTRIBUTION_OPERATOR_MIN_BALANCE=3000000
        DISTRIBUTION_OPERATOR_MAX_BALANCE=300000000
        DISTRIBUTION_UPLOADER_MIN_BALANCE=3000000
        DISTRIBUTION_UPLOADER_MAX_BALANCE=3000000
        FACILITY_OPERATOR_MIN_ETH=1
        FACILITY_OPERATOR_MAX_ETH=5
        FACILITY_CONTRACT_MIN_TOKEN=10000
        FACILITY_CONTRACT_MAX_TOKEN=100000
      }

      vault {
        policies = ["valid-ator-stage", "operator-checks-stage"]
      }

      template {
        data = <<EOH
          {{with secret "kv/valid-ator/stage"}}
            RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_OPERATOR_KEY}}"
            DISTRIBUTION_OPERATOR_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
            FACILITY_OPERATOR_KEY="{{.Data.data.FACILITY_OPERATOR_KEY}}"
            REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY}}"
            JSON_RPC="{{.Data.data.JSON_RPC}}"
            INFURA_NETWORK="{{.Data.data.INFURA_NETWORK}}"
            INFURA_WS_URL="{{.Data.data.INFURA_WS_URL}}"
            BUNDLER_NETWORK="{{.Data.data.IRYS_NETWORK}}"
            BUNDLER_NODE="https://node2.irys.xyz"
          {{end}}
          {{- range service "validator-stage-mongo" }}
            MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-stage"
          {{- end }}
          {{with secret "kv/operator-checks/stage"}}
            ETH_SPENDER_KEY="{{.Data.data.ETH_SPENDER_KEY}}"
            AR_SPENDER_KEY="{{.Data.data.AR_SPENDER_KEY}}"
          {{end}}
          RELAY_REGISTRY_CONTRACT_TXID="[[ consulKey "smart-contracts/stage/relay-registry-address" ]]"
          DISTRIBUTION_CONTRACT_TXID="[[ consulKey "smart-contracts/stage/distribution-address" ]]"
          FACILITY_CONTRACT_ADDRESS="[[ consulKey "facilitator/sepolia/stage/address" ]]"
          REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/stage/address" ]]"
          TOKEN_CONTRACT_ADDRESS="[[ consulKey "ator-token/sepolia/stage/address" ]]"
        EOH
        destination = "secrets/file.env"
        env         = true
      }

      resources {
        cpu    = 4096
        memory = 4096
      }

      service {
        name = "operator-checks-stage"
        port = "operator-checks"
        
        check {
          name     = "operator-checks health check"
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