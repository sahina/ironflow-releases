package order

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sahina/ironflow-go/ironflow"
)

// Only a lost version check is a stream conflict. A key that belongs to another
// event is also HTTP 409, and re-reading the stream does not help it.
func TestAppendMapsOnlyAbortedToConflict(t *testing.T) {
	for code, want := range map[string]bool{"aborted": true, "already_exists": false} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"` + code + `","message":"refused"}`))
		}))
		streams := NewStreams(ironflow.NewClient(ironflow.ClientConfig{ServerURL: srv.URL}))
		_, err := streams.Append(context.Background(), testOrderID, AppendFact{Name: EventOrderPaid, IdempotencyKey: "k"})
		srv.Close()
		if err == nil || IsConflict(err) != want {
			t.Errorf("%s: err = %v, conflict = %v, want %v", code, err, IsConflict(err), want)
		}
	}
}
