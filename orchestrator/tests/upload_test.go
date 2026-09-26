package tests

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

func TestUploadHandler(t *testing.T) {
	tempDir := t.TempDir()
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"mock"}}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg, nil)
	srv.SetUploadDir(tempDir)

	// 1. Test CORS preflight (OPTIONS)
	reqOpt := httptest.NewRequest(http.MethodOptions, "/api/upload", nil)
	wOpt := httptest.NewRecorder()
	srv.ServeUpload(wOpt, reqOpt)
	if wOpt.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS expected 204, got %d", wOpt.Code)
	}
	if wOpt.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected CORS origin header, got %q", wOpt.Header().Get("Access-Control-Allow-Origin"))
	}

	// 2. Test File Upload (POST multipart)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileContent := "test document contents for upload"
	part, err := writer.CreateFormFile("file", "my test doc.pdf")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = io.WriteString(part, fileContent)
	_ = writer.Close()

	reqPost := httptest.NewRequest(http.MethodPost, "/api/upload", body)
	reqPost.Header.Set("Content-Type", writer.FormDataContentType())
	wPost := httptest.NewRecorder()
	srv.ServeUpload(wPost, reqPost)

	if wPost.Code != http.StatusOK {
		t.Fatalf("POST expected 200, got %d, body: %s", wPost.Code, wPost.Body.String())
	}

	var resp server.UploadResponse
	if err := json.Unmarshal(wPost.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal upload response: %v", err)
	}

	if !strings.HasPrefix(resp.URL, "/uploads/") {
		t.Errorf("expected URL to start with /uploads/, got %q", resp.URL)
	}
	if resp.Name != "my test doc.pdf" {
		t.Errorf("expected original name 'my test doc.pdf', got %q", resp.Name)
	}
	if resp.Size != int64(len(fileContent)) {
		t.Errorf("expected size %d, got %d", len(fileContent), resp.Size)
	}

	// Verify file was written to disk
	savedFilename := strings.TrimPrefix(resp.URL, "/uploads/")
	savedPath := filepath.Join(tempDir, savedFilename)
	data, err := os.ReadFile(savedPath)
	if err != nil {
		t.Fatalf("read saved file: %v", err)
	}
	if string(data) != fileContent {
		t.Fatalf("file content mismatch: got %q, want %q", string(data), fileContent)
	}
}
