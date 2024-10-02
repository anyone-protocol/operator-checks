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
    }

    task "operator-checks-stage-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/operator-checks:[[.deploy]]"
      }

      vault {
        policies = ["valid-ator-stage"]
      }

      template {
        data = <<EOH
        {{with secret "kv/valid-ator/live"}}
          RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_OPERATOR_KEY}}"
          DISTRIBUTION_OPERATOR_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
          FACILITY_OPERATOR_KEY="{{.Data.data.FACILITY_OPERATOR_KEY}}"
          REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY}}"
          IRYS_NETWORK="{{.Data.data.IRYS_NETWORK}}"
          JSON_RPC="{{.Data.data.JSON_RPC}}"
          DRE_HOSTNAME="{{.Data.data.DRE_HOSTNAME}}"
          INFURA_NETWORK="{{.Data.data.INFURA_NETWORK}}"
          INFURA_WS_URL="{{.Data.data.INFURA_WS_URL}}"
          MAINNET_WS_URL="{{.Data.data.MAINNET_WS_URL}}"
          MAINNET_JSON_RPC="{{.Data.data.MAINNET_JSON_RPC}}"
        {{end}}
        RELAY_REGISTRY_CONTRACT_TXID="[[ consulKey "smart-contracts/live/relay-registry-address" ]]"
        DISTRIBUTION_CONTRACT_TXID="[[ consulKey "smart-contracts/live/distribution-address" ]]"
        FACILITY_CONTRACT_ADDRESS="[[ consulKey "facilitator/sepolia/live/address" ]]"
        REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/live/address" ]]"
        TOKEN_CONTRACT_ADDRESS="[[ consulKey "ator-token/sepolia/live/address" ]]"
        RELAY_UP_NFT_CONTRACT_ADDRESS="[[ consulKey "relay-up-nft-contract/live/address" ]]"
        {{- range service "validator-stage-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-stage-testnet"
        {{- end }}
        {{- range service "validator-stage-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "secrets/file.env"
        env         = true
      }

      env {
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        IRYS_NODE="https://node2.irys.xyz"
        RELAY_REGISTRY_OPERATOR_MIN_BALANCE=0
        RELAY_REGISTRY_UPLOADER_MIN_BALANCE=1000000
        DISTRIBUTION_OPERATOR_MIN_BALANCE=0
        FACILITY_OPERATOR_MIN_BALANCE=1000000
        FACILITY_TOKEN_MIN_BALANCE=1000000
        DRE_REQUEST_TIMEOUT=60000
        DRE_REQUEST_MAX_REDIRECTS=3
        DO_CLEAN="false"
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