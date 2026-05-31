# Multi-Cam Manual Validation Checklist

## Setup & Config
- [ ] In registration, switch to **Multiple Cameras** and save 2+ RTSP links with names.
- [ ] Leave at least one slot empty and verify it is accepted.
- [ ] In Settings, edit slot names/links and save again.

## Deferred Setup + Mobile Continuation
- [ ] Register a new user and choose **Continue later** after account creation.
- [ ] Restart backend and verify tunnel link email is sent to registered user on startup.
- [ ] In mobile app, connect with tunnel URL and login.
- [ ] If setup is incomplete, confirm alert prompts user to open **Settings**.
- [ ] Complete required fields in mobile settings and save.
- [ ] Verify setup status becomes complete and subsequent app usage proceeds normally.

## Recording Behavior
- [ ] Start raw recording in multi-camera mode and verify chunk files continue generating.
- [ ] Open a generated chunk: confirm 2x2 grid output with labels bottom-left.
- [ ] Empty slot renders black with **No Signal** label.

## Disconnect/Failure Cases
- [ ] During recording, disconnect one active camera stream.
- [ ] Verify overall recording continues and merged chunk still completes.
- [ ] Verify disconnected feed area does not crash the entire recorder.
- [ ] Reconnect camera; confirm subsequent chunks continue without service restart.

## Mobile Query UX
- [ ] On chat page with selected chunks, open camera scope selector.
- [ ] Confirm options include **All Cameras** + configured camera labels and positions.
- [ ] Query with one selected camera and verify response focuses on that camera.
- [ ] Query with **All Cameras** and verify response can reference multiple cameras.
- [ ] Confirm timestamps include camera references (name/slot/position language).

## Billing / Existing Flow Safety
- [ ] Submit a raw query job and verify credit debit still occurs once per query.
- [ ] Confirm results still stream incrementally chunk-by-chunk.
- [ ] Confirm autopilot processing behavior remains unchanged.

## MediaMTX RTSP Restream Proxy (multi-camera stability)
Pre-req: install MediaMTX (`mediamtx` binary on PATH). https://github.com/bluenviron/mediamtx
- [ ] Set `RTSP_PROXY_ENABLED=true` in `.env`, restart backend.
- [ ] Backend log shows `Starting MediaMTX RTSP proxy on 127.0.0.1:8554` with `cam1`/`cam2`/... paths.
- [ ] Backend log shows `RTSP proxy active; recorder will read from N local restream paths`.
- [ ] Open `rtsp://127.0.0.1:8554/cam1` in VLC and confirm the camera plays.
- [ ] Confirm multi-camera grid chunks generate continuously and show all feeds smoothly (no HEVC `Duplicate POC` / `cu_qp_delta` errors in logs).
- [ ] Disconnect one camera mid-recording; grid keeps producing chunks, only the disconnected slot freezes/goes No Signal.
- [ ] Disable the proxy (`RTSP_PROXY_ENABLED=false`) and confirm system falls back to direct RTSP without errors.
- [ ] Stop recording / shut down backend: log shows the proxy is stopped (no leftover `mediamtx` processes).
- [ ] With proxy enabled but binary missing on PATH: backend logs a warning and falls back to direct RTSP without crashing.

