package provider

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// BedrockProvider calls Claude on AWS Bedrock using SigV4 auth.
// The request/response body format is identical to Anthropic's native API.
type BedrockProvider struct {
	name      string
	region    string
	modelID   string
	accessKey string
	secretKey string
	client    *http.Client
}

func NewBedrock(name, region, modelID, accessKey, secretKey string) *BedrockProvider {
	if region == "" {
		region = "us-east-1"
	}
	return &BedrockProvider{
		name:      name,
		region:    region,
		modelID:   modelID,
		accessKey: accessKey,
		secretKey: secretKey,
		client:    &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *BedrockProvider) Name() string { return p.name }

func (p *BedrockProvider) endpoint() string {
	return fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com/model/%s/invoke", p.region, p.modelID)
}

func (p *BedrockProvider) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	maxTokens := req.MaxTokens
	if maxTokens == 0 {
		maxTokens = 1024
	}

	// Bedrock Claude uses Anthropic body format
	body := anthropicRequest{
		Model:     p.modelID,
		MaxTokens: maxTokens,
	}
	for _, m := range req.Messages {
		if m.Role == "system" {
			body.System = m.Content
		} else {
			body.Messages = append(body.Messages, anthropicMessage{Role: m.Role, Content: m.Content})
		}
	}
	for _, t := range req.Tools {
		body.Tools = append(body.Tools, anthropicTool{
			Name: t.Name, Description: t.Description, InputSchema: t.InputSchema,
		})
	}

	data, _ := json.Marshal(body)
	url := p.endpoint()

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	if err := p.signV4(httpReq, data); err != nil {
		return ChatResponse{}, fmt.Errorf("sigv4: %w", err)
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()

	rawBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return ChatResponse{}, &APIError{StatusCode: resp.StatusCode, Message: string(rawBody)}
	}

	var anthResp anthropicResponse
	if err := json.Unmarshal(rawBody, &anthResp); err != nil {
		return ChatResponse{}, fmt.Errorf("decode: %w", err)
	}

	out := ChatResponse{
		FinishReason: anthResp.StopReason,
		Usage: Usage{
			InputTokens:  anthResp.Usage.InputTokens,
			OutputTokens: anthResp.Usage.OutputTokens,
		},
	}
	for _, block := range anthResp.Content {
		switch block.Type {
		case "text":
			out.Content += block.Text
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, ToolCall{
				ID: block.ID, Name: block.Name, Arguments: block.Input,
			})
			if out.FinishReason == "" {
				out.FinishReason = "tool_use"
			}
		}
	}
	return out, nil
}

func (p *BedrockProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error) {
	ch := make(chan StreamChunk, 64)
	go func() {
		defer close(ch)
		resp, err := p.Complete(ctx, req)
		if err != nil {
			ch <- StreamChunk{Err: err}
			return
		}
		words := strings.Fields(resp.Content)
		for i, w := range words {
			if i == len(words)-1 {
				ch <- StreamChunk{Delta: w, Done: true}
			} else {
				ch <- StreamChunk{Delta: w + " "}
			}
		}
	}()
	return ch, nil
}

// signV4 adds AWS Signature Version 4 headers to the request.
func (p *BedrockProvider) signV4(req *http.Request, body []byte) error {
	now := time.Now().UTC()
	date := now.Format("20060102")
	datetime := now.Format("20060102T150405Z")
	service := "bedrock"

	// Canonical headers
	req.Header.Set("x-amz-date", datetime)
	req.Header.Set("host", req.URL.Host)

	bodyHash := hashSHA256(body)

	// Canonical request
	signedHeaders := "content-type;host;x-amz-date"
	canonicalReq := strings.Join([]string{
		req.Method,
		req.URL.Path,
		req.URL.RawQuery,
		"content-type:" + req.Header.Get("Content-Type") + "\n" +
			"host:" + req.Header.Get("host") + "\n" +
			"x-amz-date:" + datetime + "\n",
		signedHeaders,
		bodyHash,
	}, "\n")

	// String to sign
	credentialScope := strings.Join([]string{date, p.region, service, "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		datetime,
		credentialScope,
		hashSHA256([]byte(canonicalReq)),
	}, "\n")

	// Signing key
	signingKey := hmacSHA256(
		hmacSHA256(
			hmacSHA256(
				hmacSHA256([]byte("AWS4"+p.secretKey), []byte(date)),
				[]byte(p.region),
			),
			[]byte(service),
		),
		[]byte("aws4_request"),
	)

	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		p.accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
	return nil
}

func hashSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}
