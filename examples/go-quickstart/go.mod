module github.com/sahina/ironflow/examples/go-quickstart

go 1.25.0

require github.com/sahina/ironflow/sdk/go/ironflow v0.0.0

require (
	connectrpc.com/connect v1.21.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/sahina/ironflow/api/go v0.0.0-00010101000000-000000000000 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)

replace github.com/sahina/ironflow/sdk/go/ironflow => ../../sdk/go/ironflow

replace github.com/sahina/ironflow/api/go => ../../api/go
