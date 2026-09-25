package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Hub manages WebSocket clients and broadcasts events.
type Hub struct {
	mu      sync.RWMutex
	clients map[*client]bool
	send    chan []byte
	// OnConnect, if non-nil, is called when a new client connects.
	// The returned bytes (JSON) are sent only to that client as an init snapshot.
	// Must be set before any clients connect; reads are protected by the client
	// registration lock, but this field itself should be set once before Start().
	OnConnect func() []byte
}

type client struct {
	conn *websocket.Conn
	send chan []byte
}

// New creates a Hub. Call Run() in a goroutine.
func New() *Hub {
	return &Hub{
		clients: make(map[*client]bool),
		send:    make(chan []byte, 256),
	}
}

// Run processes broadcast messages and handles client lifecycle.
func (h *Hub) Run() {
	for msg := range h.send {
		h.mu.RLock()
		for c := range h.clients {
			select {
			case c.send <- msg:
			default:
				// slow client — drop
			}
		}
		h.mu.RUnlock()
	}
}

// Broadcast serialises v to JSON and sends to all connected clients.
func (h *Hub) Broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("hub: marshal: %v", err)
		return
	}
	select {
	case h.send <- b:
	default:
		log.Print("hub: send buffer full, dropping event")
	}
}

// ServeWS upgrades the HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("hub: upgrade: %v", err)
		return
	}
	c := &client{conn: conn, send: make(chan []byte, 64)}
	h.mu.Lock()
	h.clients[c] = true
	onConnect := h.OnConnect // capture under lock
	h.mu.Unlock()

	// Send init snapshot to this client only, if provided.
	if onConnect != nil {
		if payload := onConnect(); len(payload) > 0 {
			select {
			case c.send <- payload:
			default:
			}
		}
	}

	// writer goroutine
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			conn.Close()
		}()
		for msg := range c.send {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	// reader — drain pings/pongs; close channel on disconnect
	defer close(c.send)
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
