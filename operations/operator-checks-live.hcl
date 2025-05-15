job "operator-checks-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-protocol"

  group "operator-checks-live-group" {
    
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

    task "operator-checks-live-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/operator-checks:[[.commit_sha]]"
      }

      env {
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        
        REDIS_HOSTNAME="localhost"
        REDIS_PORT="${NOMAD_PORT_redis}"

        RELAY_REGISTRY_OPERATOR_MIN_BALANCE=1000000
        RELAY_REGISTRY_OPERATOR_MAX_BALANCE=100000000
        DISTRIBUTION_OPERATOR_MIN_BALANCE=3000000
        DISTRIBUTION_OPERATOR_MAX_BALANCE=300000000
        FACILITY_OPERATOR_MIN_ETH=1
        FACILITY_OPERATOR_MAX_ETH=5
        FACILITY_CONTRACT_MIN_TOKEN=10000
        FACILITY_CONTRACT_MAX_TOKEN=100000
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
          {{with secret "kv/live-protocol/operator-checks-live"}}
            RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_CONTROLLER_KEY}}"
            DISTRIBUTION_OPERATOR_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY_DEPRECATED}}"
            FACILITY_OPERATOR_KEY="{{.Data.data.FACILITY_OPERATOR_KEY_DEPRECATED}}"
            REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY_DEPRECATED}}"
            JSON_RPC="{{.Data.data.JSON_RPC}}"
            INFURA_NETWORK="{{.Data.data.INFURA_NETWORK}}"
            INFURA_WS_URL="{{.Data.data.INFURA_WS_URL}}"
            BUNDLER_NETWORK="{{.Data.data.BUNDLER_NETWORK}}"
            ETH_SPENDER_KEY="{{.Data.data.ETH_SPENDER_KEY}}"
            AR_SPENDER_KEY={{ base64Decode .Data.data.AR_SPENDER_KEY_BASE64 | toJSON }}
            BUNDLER_OPERATOR_JWK={{ base64Decode .Data.data.BUNDLER_KEY_BASE64 | toJSON }}
          {{end}}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      template {
        data = <<-EOH
          RELAY_REGISTRY_CONTRACT_TXID="[[ consulKey "smart-contracts/live/relay-registry-address" ]]"
          DISTRIBUTION_CONTRACT_TXID="[[ consulKey "smart-contracts/live/distribution-address" ]]"
          FACILITY_CONTRACT_ADDRESS="[[ consulKey "facilitator/sepolia/live/address" ]]"
          REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/live/address" ]]"
          TOKEN_CONTRACT_ADDRESS="[[ consulKey "ator-token/sepolia/live/address" ]]"
          {{- range service "validator-live-mongo" }}
            MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/operator-checks-live"
          {{- end }}
          {{- range service "ario-any1-envoy" }}
            ARWEAVE_GATEWAY_PROTOCOL="http"
            ARWEAVE_GATEWAY_HOST="{{ .Address }}"
            ARWEAVE_GATEWAY_PORT={{ .Port }}
          {{ end -}}
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
        port = "operator-checks"
        tags = ["logging"]
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

    task "operator-checks-redis-live" {
      lifecycle {
        hook = "prestart"
        sidecar = true
      }

      driver = "docker"
      config {
        image = "redis:7.2"
        args = ["/usr/local/etc/redis/redis.conf"]
        volumes = [
          "local/redis.conf:/usr/local/etc/redis/redis.conf"
        ]
      }

      template {
        data = <<-EOH
          # Based on https://raw.githubusercontent.com/redis/redis/7.2/redis.conf
          bind 0.0.0.0
          port {{ env "NOMAD_PORT_redis" }}
          protected-mode no
          tcp-backlog 511
          timeout 0
          tcp-keepalive 300
          daemonize no
          pidfile /tmp/redis_6379.pid
          loglevel notice
          logfile ""
          databases 16
          always-show-logo no
          set-proc-title yes
          proc-title-template "{title} {listen-addr} {server-mode}"
          locale-collate ""
          stop-writes-on-bgsave-error yes
          rdbcompression yes
          rdbchecksum yes
          dbfilename dump.rdb
          rdb-del-sync-files no
          dir ./
          replica-serve-stale-data yes
          replica-read-only yes
          repl-diskless-sync yes
          repl-diskless-sync-delay 5
          repl-diskless-sync-max-replicas 0
          repl-diskless-load disabled
          repl-disable-tcp-nodelay no
          replica-priority 100
          acllog-max-len 128
          lazyfree-lazy-eviction no
          lazyfree-lazy-expire no
          lazyfree-lazy-server-del no
          replica-lazy-flush no
          lazyfree-lazy-user-del no
          lazyfree-lazy-user-flush no
          oom-score-adj no
          oom-score-adj-values 0 200 800
          disable-thp yes
          appendonly yes
          appendfilename "appendonly.aof"
          appenddirname "appendonlydir"
          appendfsync everysec
          no-appendfsync-on-rewrite no
          auto-aof-rewrite-percentage 100
          auto-aof-rewrite-min-size 64mb
          aof-load-truncated yes
          aof-use-rdb-preamble yes
          aof-timestamp-enabled no
          slowlog-log-slower-than 10000
          slowlog-max-len 128
          latency-monitor-threshold 0
          notify-keyspace-events ""
          hash-max-listpack-entries 512
          hash-max-listpack-value 64
          list-max-listpack-size -2
          list-compress-depth 0
          set-max-intset-entries 512
          set-max-listpack-entries 128
          set-max-listpack-value 64
          zset-max-listpack-entries 128
          zset-max-listpack-value 64
          hll-sparse-max-bytes 3000
          stream-node-max-bytes 4096
          stream-node-max-entries 100
          activerehashing yes
          client-output-buffer-limit normal 0 0 0
          client-output-buffer-limit replica 256mb 64mb 60
          client-output-buffer-limit pubsub 32mb 8mb 60
          hz 10
          dynamic-hz yes
          aof-rewrite-incremental-fsync yes
          rdb-save-incremental-fsync yes
          jemalloc-bg-thread yes
        EOH
        destination = "local/redis.conf"
        env         = false
      }

      resources {
        cpu    = 2048
        memory = 2048
      }

      service {
        name = "operator-checks-live-redis"
        port = "redis"
        tags = ["logging"]
        check {
          name     = "live Redis health check"
          type     = "tcp"
          interval = "5s"
          timeout  = "10s"
        }
      }
    }
  }
}
