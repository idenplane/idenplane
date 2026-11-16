package idenplane

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// slowServer answers GET /admin/realms/demo/users/u1 after delay. With
// partialBody it sends the headers and half a JSON body first, then stalls.
func slowServer(t *testing.T, delay time.Duration, partialBody bool) *httptest.Server {
	t.Helper()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if partialBody {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"u1","username":"de`))
			w.(http.Flusher).Flush()
		}
		select {
		case <-time.After(delay):
		case <-release:
		case <-r.Context().Done():
		}
		if !partialBody {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"u1","username":"demo"}`))
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})
	return srv
}

func demoClient(serverURL string, httpClient *http.Client) *Client {
	return NewClient(Config{
		ServerURL:  serverURL,
		Realm:      "demo",
		ClientID:   "demo-client",
		HTTPClient: httpClient,
	})
}

func TestIsRetryableBareErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"context.Canceled", context.Canceled, false},
		{"context.DeadlineExceeded", context.DeadlineExceeded, false},
		{"wrapped Canceled", fmt.Errorf("op: %w", context.Canceled), false},
		{"wrapped DeadlineExceeded", fmt.Errorf("op: %w", context.DeadlineExceeded), false},
		{"SDK network error wrapping Canceled", ErrNetworkError("request failed", context.Canceled), false},
		{"SDK network error", ErrNetworkError("request failed", errors.New("connection reset")), true},
		{"SDK server error", ErrServerError("status 503"), true},
		{"SDK not found", ErrUserNotFound("u1"), false},
		{"SDK invalid config", ErrInvalidConfig("bad"), false},
		{"other error", errors.New("boom"), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsRetryable(tc.err); got != tc.want {
				t.Fatalf("IsRetryable(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsRetryableCallerCancelledBeforeRequest(t *testing.T) {
	srv := slowServer(t, time.Second, false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := demoClient(srv.URL, nil).Users.Get(ctx, "u1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled in the chain, got %v", err)
	}
	if IsRetryable(err) {
		t.Fatalf("IsRetryable = true for a caller cancellation: %v", err)
	}
}

func TestIsRetryableCallerCancelledDuringRequest(t *testing.T) {
	srv := slowServer(t, 5*time.Second, false)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)

	_, err := demoClient(srv.URL, nil).Users.Get(ctx, "u1")
	if err == nil || IsRetryable(err) {
		t.Fatalf("expected a non-retryable error, got %v (retryable=%v)", err, IsRetryable(err))
	}
}

func TestIsRetryableCallerDeadline(t *testing.T) {
	srv := slowServer(t, 5*time.Second, false)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := demoClient(srv.URL, nil).Users.Get(ctx, "u1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context.DeadlineExceeded in the chain, got %v", err)
	}
	if IsRetryable(err) {
		t.Fatalf("IsRetryable = true when the caller's deadline passed: %v", err)
	}
}

func TestIsRetryableCallerDeadlineWhileReadingBody(t *testing.T) {
	srv := slowServer(t, 5*time.Second, true)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := demoClient(srv.URL, nil).Users.Get(ctx, "u1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if IsRetryable(err) {
		t.Fatalf("IsRetryable = true for a body cut short by the caller's deadline: %v", err)
	}
}

func TestIsRetryableHTTPClientTimeoutStaysRetryable(t *testing.T) {
	srv := slowServer(t, 5*time.Second, false)
	httpClient := &http.Client{Timeout: 50 * time.Millisecond}

	_, err := demoClient(srv.URL, httpClient).Users.Get(context.Background(), "u1")
	if err == nil {
		t.Fatal("expected an error")
	}
	var sdkErr *Error
	if !errors.As(err, &sdkErr) || sdkErr.Code != ErrCodeNetworkError {
		t.Fatalf("expected a network error, got %v", err)
	}
	if !IsRetryable(err) {
		t.Fatalf("IsRetryable = false for an HTTP client timeout with a live context: %v", err)
	}
}

func TestIsRetryableDiscoveryCancelled(t *testing.T) {
	srv := slowServer(t, 5*time.Second, false)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	d := NewDiscoveryClient(Config{ServerURL: srv.URL, Realm: "demo", ClientID: "demo-client"})
	_, err := d.fetch(ctx)
	if err == nil || IsRetryable(err) {
		t.Fatalf("expected a non-retryable error, got %v (retryable=%v)", err, IsRetryable(err))
	}
}
