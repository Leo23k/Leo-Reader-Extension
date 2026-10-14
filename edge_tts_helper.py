#!/usr/bin/env python3
"""Local bridge from Leo Reader to Microsoft's Edge Read Aloud voices."""

import asyncio
import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import edge_tts

HOST = "127.0.0.1"
PORT = 17843
MAX_BODY = 128_000
VOICE_CACHE_SECONDS = 600
TICKS_PER_SECOND = 10_000_000
voice_cache = {"time": 0, "voices": []}
voice_lock = threading.Lock()


def voices():
    with voice_lock:
        if time.time() - voice_cache["time"] > VOICE_CACHE_SECONDS:
            voice_cache["voices"] = asyncio.run(edge_tts.list_voices())
            voice_cache["time"] = time.time()
        return voice_cache["voices"]


async def synthesize(text, voice, rate):
    audio = bytearray()
    boundaries = []
    search_from = 0
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            word = chunk["text"]
            position = text.find(word, search_from)
            if position < 0:
                position = search_from
            search_from = position + len(word)
            boundaries.append({
                "offset": chunk["offset"] / TICKS_PER_SECOND,
                "charIndex": position,
            })
    if not audio:
        raise RuntimeError("Edge TTS returned no audio.")
    return bytes(audio), boundaries


class Handler(BaseHTTPRequestHandler):
    server_version = "LeoReaderEdgeBridge/1"

    def _cors(self, origin):
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Expose-Headers", "X-Word-Boundaries")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")
        return True

    def _send(self, status, content_type, data, extra_headers=None):
        origin = self.headers.get("Origin", "")
        if not origin.startswith("chrome-extension://"):
            self.send_error(403, "Only browser extension pages may use this helper.")
            return
        self.send_response(status)
        self._cors(origin)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if not origin.startswith("chrome-extension://"):
            self.send_error(403, "Only browser extension pages may use this helper.")
            return
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send(200, "application/json", b'{"ok":true}')
        elif self.path == "/voices":
            try:
                available = [
                    {"name": voice["ShortName"], "locale": voice["Locale"], "gender": voice.get("Gender", "")}
                    for voice in voices() if voice.get("Locale", "").lower().startswith("vi")
                ]
                self._send(200, "application/json; charset=utf-8", json.dumps(available, ensure_ascii=False).encode())
            except Exception as error:
                self._send(502, "application/json", json.dumps({"error": str(error)}).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self.send_error(413, "Request body is empty or too large.")
                return
            payload = json.loads(self.rfile.read(length))
            text = payload.get("text", "")
            voice = payload.get("voice", "")
            speed = float(payload.get("speed", 1))
            if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > 100_000:
                self.send_error(400, "Text is empty or too long.")
                return
            if not isinstance(voice, str) or not any(item.get("ShortName") == voice and item.get("Locale", "").lower().startswith("vi") for item in voices()):
                self.send_error(400, "Unknown Vietnamese Edge voice.")
                return
            if not 0.5 <= speed <= 2:
                self.send_error(400, "Speed must be between 0.5 and 2.")
                return
            rate = f"{round((speed - 1) * 100):+d}%"
            audio, boundaries = asyncio.run(synthesize(text, voice, rate))
            encoded = base64.b64encode(json.dumps(boundaries, separators=(",", ":")).encode()).decode()
            self._send(200, "audio/mpeg", audio, {"X-Word-Boundaries": encoded})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))
        except Exception as error:
            self.send_error(502, f"Edge TTS failed: {error}")

    def log_message(self, _format, *_args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Leo Reader Edge TTS helper running at http://{HOST}:{PORT}")
    print("Keep this window open while using Edge voices; press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
