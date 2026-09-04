package order

// The seam between the domain and Ironflow. Everything that talks to an order
// stream goes through Streams, so the handlers can be exercised against a fake
// and the optimistic-concurrency rules can be asserted without a server.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// AppendFact is one write to an order stream.
type AppendFact struct {
	Name string
	Data any
	// ExpectedVersion is the version the stream must be at. 0 means "this
	// stream does not exist yet", which is how an order is placed exactly once.
	ExpectedVersion int64
	// IdempotencyKey is derived from the order and the operation, never from
	// process-local randomness: a redelivered command reuses it and the engine
	// returns the original event instead of appending a second fact.
	IdempotencyKey string
	Metadata       map[string]any
}

// Streams is the order stream, from this context's point of view. Ordering is
// the sole writer of `order-{orderId}`; nothing here can reach another
// context's stream.
type Streams interface {
	Read(ctx context.Context, orderID string) ([]Fact, error)
	Append(ctx context.Context, orderID string, fact AppendFact) (int64, error)
}

// ErrConflict reports an optimistic-concurrency failure: the stream moved while
// this handler was deciding.
var ErrConflict = errors.New("stream version conflict")

// IsConflict reports whether err is a version conflict from any Streams
// implementation.
func IsConflict(err error) bool {
	return errors.Is(err, ErrConflict)
}

type clientStreams struct {
	client *ironflow.Client
}

// NewStreams returns the Streams backed by a live Ironflow client.
func NewStreams(client *ironflow.Client) Streams {
	return clientStreams{client: client}
}

func (s clientStreams) Read(ctx context.Context, orderID string) ([]Fact, error) {
	events, err := s.client.ReadStream(ctx, StreamID(orderID))
	if err != nil {
		return nil, fmt.Errorf("read order stream: %w", err)
	}
	facts := make([]Fact, 0, len(events))
	for _, event := range events {
		facts = append(facts, Fact{
			Name:          event.Name,
			Data:          event.Data,
			Metadata:      event.Metadata,
			EntityVersion: int64(event.EntityVersion),
		})
	}
	return facts, nil
}

func (s clientStreams) Append(ctx context.Context, orderID string, fact AppendFact) (int64, error) {
	// The SDK sends `data` as-is; going through JSON here means the wire shape
	// is the struct's JSON tags, which is what the registered schema validates.
	data, err := toMap(fact.Data)
	if err != nil {
		return 0, err
	}

	opts := []ironflow.AppendOption{
		ironflow.WithExpectedVersion(fact.ExpectedVersion),
		ironflow.WithAppendIdempotencyKey(fact.IdempotencyKey),
	}
	if len(fact.Metadata) > 0 {
		opts = append(opts, ironflow.WithAppendMetadata(fact.Metadata))
	}

	result, err := s.client.AppendStreamEvent(ctx, StreamID(orderID), ironflow.AppendEventInput{
		Name:       fact.Name,
		Data:       data,
		EntityType: EntityType,
	}, opts...)
	if err != nil {
		// A version conflict arrives as Connect ABORTED, which the SDK surfaces
		// as HTTP 409 / ironflow.ErrConflict.
		if errors.Is(err, ironflow.ErrConflict) {
			return 0, fmt.Errorf("%w: %s at expected version %d: %w",
				ErrConflict, fact.Name, fact.ExpectedVersion, err)
		}
		return 0, fmt.Errorf("append %s: %w", fact.Name, err)
	}
	return int64(result.EntityVersion), nil
}

func toMap(value any) (map[string]any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal event data: %w", err)
	}
	var out map[string]any
	if err := json.Unmarshal(encoded, &out); err != nil {
		return nil, fmt.Errorf("unmarshal event data: %w", err)
	}
	return out, nil
}

// FactMetadata is the metadata every fact this service writes carries. Empty
// values are dropped rather than written as "".
func FactMetadata(orderID, causationID, demoSessionID string) map[string]any {
	metadata := map[string]any{
		"correlationId": orderID,
		"causationId":   causationID,
		"producer":      Producer,
	}
	if demoSessionID != "" {
		metadata["demoSessionId"] = demoSessionID
	}
	return metadata
}

// DemoSessionOf reads the demo session from an event's metadata.
func DemoSessionOf(metadata map[string]any) string {
	session, _ := metadata["demoSessionId"].(string)
	return session
}
