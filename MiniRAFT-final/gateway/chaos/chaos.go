package chaos

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"
	"miniraft/gateway/leader"
)

// dockerHTTP is a minimal Docker API client that talks to the Docker daemon
// over the Unix socket using only stdlib net/http.
type dockerHTTP struct {
	client *http.Client
}

func newDockerHTTP() *dockerHTTP {
	return &dockerHTTP{
		client: &http.Client{
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return (&net.Dialer{}).DialContext(ctx, "unix", "/var/run/docker.sock")
				},
			},
		},
	}
}

// ContainerStop sends POST /containers/{id}/stop?t={timeout} to the Docker daemon.
func (d *dockerHTTP) ContainerStop(ctx context.Context, containerID string, timeoutSec int) error {
	url := fmt.Sprintf("http://localhost/containers/%s/stop?t=%d", containerID, timeoutSec)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode != 304 {
		return fmt.Errorf("docker ContainerStop: HTTP %d", resp.StatusCode)
	}
	return nil
}

// ContainerKill sends POST /containers/{id}/kill?signal={sig} to the Docker daemon.
func (d *dockerHTTP) ContainerKill(ctx context.Context, containerID string, signal string) error {
	url := fmt.Sprintf("http://localhost/containers/%s/kill?signal=%s", containerID, signal)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("docker ContainerKill: HTTP %d", resp.StatusCode)
	}
	return nil
}

// NetworkDisconnect disconnects a container from a network (simulates partition).
func (d *dockerHTTP) NetworkDisconnect(ctx context.Context, networkID, containerID string) error {
	body := fmt.Sprintf(`{"Container":"%s","Force":true}`, containerID)
	reqURL := fmt.Sprintf("http://localhost/networks/%s/disconnect", networkID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("docker NetworkDisconnect: HTTP %d", resp.StatusCode)
	}
	return nil
}

// NetworkConnect reconnects a container to a network (heals partition).
func (d *dockerHTTP) NetworkConnect(ctx context.Context, networkID, containerID string) error {
	body := fmt.Sprintf(`{"Container":"%s"}`, containerID)
	reqURL := fmt.Sprintf("http://localhost/networks/%s/connect", networkID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("docker NetworkConnect: HTTP %d", resp.StatusCode)
	}
	return nil
}

// networkForContainer returns the first user-defined (non-bridge) network
// that the container belongs to, along with the network ID.
func (d *dockerHTTP) networkForContainer(ctx context.Context, containerID string) (networkID, networkName string, err error) {
	reqURL := fmt.Sprintf("http://localhost/containers/%s/json", containerID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var info struct {
		NetworkSettings struct {
			Networks map[string]struct {
				NetworkID string `json:"NetworkID"`
			} `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", "", err
	}
	// Pick the first network that isn't "bridge" or "host"
	for name, net := range info.NetworkSettings.Networks {
		if name != "bridge" && name != "host" && name != "none" {
			return net.NetworkID, name, nil
		}
	}
	return "", "", fmt.Errorf("no user-defined network found for container %s", containerID)
}

// containerForService queries the Docker daemon for the container that has the
// compose label com.docker.compose.service=<service>.
func (d *dockerHTTP) containerForService(ctx context.Context, service string) (id, name string, err error) {
	filter := fmt.Sprintf(`{"label":["com.docker.compose.service=%s"]}`, service)
	reqURL := "http://localhost/containers/json?filters=" + url.QueryEscape(filter)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var containers []struct {
		ID    string   `json:"Id"`
		Names []string `json:"Names"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return "", "", err
	}
	if len(containers) == 0 {
		return "", "", fmt.Errorf("no container found for compose service %q", service)
	}
	cid := containers[0].ID
	cname := strings.TrimPrefix(containers[0].Names[0], "/")
	return cid, cname, nil
}

// ChaosRequest is the JSON body for POST /chaos.
type ChaosRequest struct {
	Target string `json:"target"` // "random"|"replica1"|"replica2"|"replica3"|"replica4"
	Mode   string `json:"mode"`   // "graceful"|"hard"|"partition"|"heal"|"random"
}

// ChaosResponse is returned after a chaos action.
type ChaosResponse struct {
	Killed    string `json:"killed,omitempty"`
	Partition string `json:"partition,omitempty"`
	Healed    string `json:"healed,omitempty"`
	Mode      string `json:"mode"`
	Timestamp int64  `json:"timestamp"`
}

// ChaosHandler executes chaos actions against Docker containers.
type ChaosHandler struct {
	docker  *dockerHTTP
	tracker *leader.LeaderTracker
	logger  *zap.Logger
	metrics interface{ IncrChaos(mode string) }

	// Track partitioned containers so heal knows what to reconnect.
	partitioned map[string]partitionInfo // containerID -> info
}

type partitionInfo struct {
	networkID   string
	networkName string
	containerID string
	service     string
}

// NewChaosHandler creates a new ChaosHandler, connecting to the Docker daemon.
func NewChaosHandler(tracker *leader.LeaderTracker, logger *zap.Logger, metrics interface{ IncrChaos(mode string) }) (*ChaosHandler, error) {
	return &ChaosHandler{
		docker:      newDockerHTTP(),
		tracker:     tracker,
		logger:      logger,
		metrics:     metrics,
		partitioned: make(map[string]partitionInfo),
	}, nil
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ServeHTTP handles POST /chaos requests.
func (h *ChaosHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ChaosRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Resolve target
	target := req.Target
	if target == "random" || target == "" {
		statuses := h.tracker.GetAllStatuses()
		var healthy []string
		for _, s := range statuses {
			if s.Healthy {
				healthy = append(healthy, s.ReplicaID)
			}
		}
		if len(healthy) == 0 {
			for _, s := range statuses {
				healthy = append(healthy, s.ReplicaID)
			}
		}
		if len(healthy) > 0 {
			target = healthy[rand.Intn(len(healthy))]
		} else {
			jsonError(w, "no replicas available", http.StatusServiceUnavailable)
			return
		}
	}

	// Resolve mode
	mode := req.Mode
	if mode == "random" || mode == "" {
		modes := []string{"graceful", "hard", "partition"}
		mode = modes[rand.Intn(len(modes))]
	}

	ctx := r.Context()

	// Handle heal separately — reconnects a previously partitioned container.
	if mode == "heal" {
		h.handleHeal(ctx, w, target)
		return
	}

	// Resolve container.
	containerID, containerName, err := h.docker.containerForService(ctx, target)
	if err != nil {
		h.logger.Error("could not resolve container", zap.String("service", target), zap.Error(err))
		jsonError(w, "container not found for "+target+": "+err.Error(), http.StatusNotFound)
		return
	}

	var resp ChaosResponse
	resp.Timestamp = time.Now().UnixMilli()
	resp.Mode = mode

	switch mode {
	case "graceful":
		if err := h.docker.ContainerStop(ctx, containerID, 5); err != nil {
			h.logger.Error("ContainerStop failed", zap.Error(err))
			jsonError(w, "chaos action failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		resp.Killed = containerName
		h.logger.Info("chaos: graceful stop", zap.String("container", containerName))

	case "hard":
		if err := h.docker.ContainerKill(ctx, containerID, "SIGKILL"); err != nil {
			h.logger.Error("ContainerKill failed", zap.Error(err))
			jsonError(w, "chaos action failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		resp.Killed = containerName
		h.logger.Info("chaos: hard kill", zap.String("container", containerName))

	case "partition":
		networkID, networkName, err := h.docker.networkForContainer(ctx, containerID)
		if err != nil {
			h.logger.Error("networkForContainer failed", zap.Error(err))
			jsonError(w, "partition failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err := h.docker.NetworkDisconnect(ctx, networkID, containerID); err != nil {
			h.logger.Error("NetworkDisconnect failed", zap.Error(err))
			jsonError(w, "partition failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Remember so heal can reconnect.
		h.partitioned[target] = partitionInfo{
			networkID:   networkID,
			networkName: networkName,
			containerID: containerID,
			service:     target,
		}
		resp.Partition = containerName
		h.logger.Info("chaos: network partition",
			zap.String("container", containerName),
			zap.String("network", networkName),
		)
		// Auto-heal after 15 seconds so the demo doesn't get stuck.
		go func() {
			time.Sleep(15 * time.Second)
			healCtx := context.Background()
			if info, ok := h.partitioned[target]; ok {
				if err := h.docker.NetworkConnect(healCtx, info.networkID, info.containerID); err != nil {
					h.logger.Warn("auto-heal NetworkConnect failed", zap.Error(err))
				} else {
					h.logger.Info("chaos: auto-healed partition", zap.String("container", containerName))
					delete(h.partitioned, target)
				}
			}
		}()

	default:
		jsonError(w, "unknown mode: "+mode, http.StatusBadRequest)
		return
	}

	if h.metrics != nil {
		h.metrics.IncrChaos(mode)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// handleHeal reconnects a previously partitioned replica to the network.
func (h *ChaosHandler) handleHeal(ctx context.Context, w http.ResponseWriter, target string) {
	info, ok := h.partitioned[target]
	if !ok {
		// Try to heal all if target is "all"
		if target == "all" {
			count := 0
			for svc, inf := range h.partitioned {
				if err := h.docker.NetworkConnect(ctx, inf.networkID, inf.containerID); err != nil {
					h.logger.Warn("heal failed", zap.String("service", svc), zap.Error(err))
				} else {
					delete(h.partitioned, svc)
					count++
				}
			}
			resp := ChaosResponse{Healed: fmt.Sprintf("%d replica(s)", count), Mode: "heal", Timestamp: time.Now().UnixMilli()}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		jsonError(w, target+" is not currently partitioned", http.StatusBadRequest)
		return
	}

	if err := h.docker.NetworkConnect(ctx, info.networkID, info.containerID); err != nil {
		h.logger.Error("NetworkConnect failed", zap.Error(err))
		jsonError(w, "heal failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	delete(h.partitioned, target)
	h.logger.Info("chaos: healed partition", zap.String("service", target))

	if h.metrics != nil {
		h.metrics.IncrChaos("heal")
	}

	resp := ChaosResponse{Healed: info.containerID[:12], Mode: "heal", Timestamp: time.Now().UnixMilli()}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// ServeHTTPStub is a no-op handler used when Docker is unavailable.
func ServeHTTPStub(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "chaos endpoint unavailable: Docker socket not accessible",
	})
}
