package server

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// UploadResponse is returned upon successful file upload.
type UploadResponse struct {
	URL  string `json:"url"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	Type string `json:"type"`
}

var safeFilenameRe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// sanitizeFilename strips path traversal and cleans filename characters.
func sanitizeFilename(name string) string {
	base := filepath.Base(name)
	if idx := strings.LastIndex(base, "\\"); idx != -1 {
		base = base[idx+1:]
	}
	clean := safeFilenameRe.ReplaceAllString(base, "_")
	clean = strings.Trim(clean, "._- ")
	if clean == "" {
		clean = "file.bin"
	}
	return clean
}

// ServeUpload is the exported handler for testing.
func (s *Server) ServeUpload(w http.ResponseWriter, r *http.Request) {
	s.handleUpload(w, r)
}

// SetUploadDir overrides the target upload directory (useful for testing).
func (s *Server) SetUploadDir(dir string) {
	s.uploadDir = dir
}

// getUploadDir returns the resolved directory where files are stored.
func (s *Server) getUploadDir() string {
	if s.uploadDir != "" {
		return s.uploadDir
	}
	if info, err := os.Stat("orchestrator"); err == nil && info.IsDir() {
		return filepath.Join("orchestrator", "uploads")
	}
	return "uploads"
}

// handleUpload processes multipart uploads up to 50MB.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Limit request body to 50MB
	const maxUploadSize = 50 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		http.Error(w, fmt.Sprintf("file too large or invalid multipart form: %v", err), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, fmt.Sprintf("form file 'file' required: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	uploadDir := s.getUploadDir()
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("create upload directory: %v", err), http.StatusInternalServerError)
		return
	}

	origName := header.Filename
	sanitized := sanitizeFilename(origName)
	savedName := fmt.Sprintf("%d_%s", time.Now().Unix(), sanitized)

	dstPath := filepath.Join(uploadDir, savedName)
	dst, err := os.Create(dstPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("save file: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		http.Error(w, fmt.Sprintf("write file: %v", err), http.StatusInternalServerError)
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		if extType := mime.TypeByExtension(filepath.Ext(sanitized)); extType != "" {
			mimeType = extType
		} else {
			mimeType = "application/octet-stream"
		}
	}

	resp := UploadResponse{
		URL:  "/uploads/" + savedName,
		Name: origName,
		Size: written,
		Type: mimeType,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}
