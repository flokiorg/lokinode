package wails

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/tidwall/gjson"
)

var httpClient = http.Client{
	Timeout: 10 * time.Second,
}

// maxResponseBytes caps the amount read from any external HTTP response.
// Prevents OOM if a compromised or malicious server returns an unbounded body.
const maxResponseBytes = 1 * 1024 * 1024 // 1 MB

func httpGet(url string) ([]byte, error) {
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return body, nil
}

// GetBlocksTipHeight fetches the current chain tip height from a Flokicoin
// block explorer (e.g. https://explorer.flokicoin.org).
func GetBlocksTipHeight(explorerHost string) (int64, error) {
	body, err := httpGet(explorerHost + "/api/blocks/tip/height")
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(string(body), 10, 64)
}

// GetRecommendedFees fetches the recommended fee rates (sat/vbyte) from the
// block explorer. Returns zeros gracefully if the endpoint is unavailable.
func GetRecommendedFees(explorerHost string) (fastest, halfHour, economy int64, err error) {
	body, err := httpGet(explorerHost + "/api/v1/fees/recommended")
	if err != nil {
		return 0, 0, 0, nil // graceful degradation
	}
	fastest = gjson.GetBytes(body, "fastestFee").Int()
	halfHour = gjson.GetBytes(body, "halfHourFee").Int()
	economy = gjson.GetBytes(body, "economyFee").Int()
	return fastest, halfHour, economy, nil
}

// GetGithubLatestVersion fetches the latest release tag from GitHub.
func GetGithubLatestVersion() (string, error) {
	body, err := httpGet("https://api.github.com/repos/ohstr/lokinode/releases/latest")
	if err != nil {
		return "", err
	}
	if gjson.GetBytes(body, "prerelease").Bool() {
		return "", errors.New("fetch latest version failed")
	}
	return gjson.GetBytes(body, "tag_name").String(), nil
}
