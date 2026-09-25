#!/usr/bin/env python3
"""Probe a provider's /models endpoint and suggest the best model to use.

Usage:
    python3 probe_provider.py <provider-id> [--env-file PATH] [--update-json]

    python3 probe_provider.py atessa --env-file D:/pRoG/jarvis/.env
    python3 probe_provider.py aihubmix --update-json  # patches providers.json with best model

Prints all available models ranked by likely coding strength, and optionally
patches the 'model' field in providers.json for that provider.
"""
import argparse
import json
import os
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).parent.parent
PROVIDERS_JSON = SKILL_DIR / "references" / "providers.json"

CODE_KEYWORDS = [
    "coder", "code", "swe", "dev",
    "opus", "fable", "sonnet-4", "claude",
    "deepseek-v4-pro", "deepseek-r1", "deepseek-v4",
    "gpt-6", "gpt-5",
    "qwen3.8", "qwen-max", "qwen3.7", "qwen2.5-coder",
    "kimi-k2", "llama-3.3-70b", "mistral-large",
    "nemotron", "command-r-plus",
]
DEPRIORITIZE = ["gemini", "embedding", "whisper", "vision", "tts", "dall", "image", "stable"]


def load_env(path: str | None):
    if not path:
        return
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() and v.strip() and not os.environ.get(k.strip()):
                    os.environ[k.strip()] = v.strip()
    except OSError as e:
        print(f"[warn] could not load .env: {e}")


def load_providers() -> dict:
    data = json.loads(PROVIDERS_JSON.read_text())
    return {p["id"]: p for p in data.get("providers", []) if "id" in p}


def score_model(model_id: str) -> int:
    mid = model_id.lower()
    if any(d in mid for d in DEPRIORITIZE):
        return -100
    score = 0
    for i, kw in enumerate(CODE_KEYWORDS):
        if kw in mid:
            score += max(1, len(CODE_KEYWORDS) - i)
    # bonus for "pro", "max", "strong", "plus", "ultra"
    for bonus in ["pro", "max", "strong", "plus", "ultra", "large", "turbo"]:
        if bonus in mid:
            score += 2
    # free models get a small boost for cost efficiency
    if ":free" in mid:
        score += 1
    return score


def fetch_models(base_url: str, api_key: str) -> list[str]:
    try:
        import openai
        client = openai.OpenAI(api_key=api_key, base_url=base_url)
        models = client.models.list()
        return [m.id for m in models.data]
    except ImportError:
        # fallback: raw curl via subprocess
        import subprocess
        result = subprocess.run(
            ["curl", "-s", "-H", f"Authorization: Bearer {api_key}",
             f"{base_url.rstrip('/')}/models"],
            capture_output=True, text=True, timeout=15
        )
        data = json.loads(result.stdout)
        return [m["id"] for m in data.get("data", [])]


def patch_providers_json(provider_id: str, model: str):
    raw = json.loads(PROVIDERS_JSON.read_text())
    for p in raw.get("providers", []):
        if p.get("id") == provider_id:
            p["model"] = model
            break
    PROVIDERS_JSON.write_text(json.dumps(raw, indent=2))
    print(f"[patched] {provider_id} → model: {model}")


def main():
    p = argparse.ArgumentParser(description="Probe a provider's model list")
    p.add_argument("provider_id", help="Provider ID from providers.json (e.g. atessa, aihubmix)")
    p.add_argument("--env-file", default=None, help="Path to .env file to load keys from")
    p.add_argument("--update-json", action="store_true", help="Patch providers.json with the top-ranked model")
    p.add_argument("--top", type=int, default=15, help="How many ranked models to show (default 15)")
    args = p.parse_args()

    # Load .env — check common jarvis locations if not specified
    env_path = args.env_file
    if not env_path:
        for candidate in [
            r"D:\pRoG\jarvis\.env",
            Path.home() / "pRoG" / "jarvis" / ".env",
            Path.cwd() / ".env",
        ]:
            if Path(candidate).is_file():
                env_path = str(candidate)
                break
    load_env(env_path)

    providers = load_providers()
    if args.provider_id not in providers:
        print(f"Unknown provider: {args.provider_id}")
        print("Known IDs:", ", ".join(providers))
        sys.exit(1)

    prov = providers[args.provider_id]
    base_url = prov.get("base_url")
    key_env = prov.get("api_key_env", "")
    api_key = os.environ.get(key_env, "")

    if not base_url:
        print(f"{args.provider_id} uses a special handler ({prov.get('handler')}) — no /models endpoint to probe.")
        sys.exit(0)
    if not api_key:
        print(f"API key env var {key_env!r} not set. Load your .env or set it manually.")
        sys.exit(1)

    print(f"Probing {prov['label']} ({base_url}) ...")
    try:
        model_ids = fetch_models(base_url, api_key)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    print(f"Found {len(model_ids)} models. Top {args.top} ranked for code:\n")
    ranked = sorted(model_ids, key=score_model, reverse=True)
    for i, mid in enumerate(ranked[:args.top], 1):
        score = score_model(mid)
        print(f"  {i:>2}. [{score:>3}] {mid}")

    if ranked:
        best = ranked[0]
        print(f"\nTop pick: {best}")
        if args.update_json:
            patch_providers_json(args.provider_id, best)


if __name__ == "__main__":
    main()
