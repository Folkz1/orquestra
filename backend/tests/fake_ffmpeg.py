"""
Fake ffmpeg/ffprobe for tests. Cross-platform (invoked as `python fake_ffmpeg.py <mode> ...args`).

Behaviour is controlled by env vars so each test can shape it:
  FAKE_FF_SLEEP      seconds to sleep before finishing (simulates slow encode)
  FAKE_FF_OUT_BYTES  size of the output file ffmpeg writes (default 1024)
  FAKE_FF_PROBE_OUT  what ffprobe prints on stdout (e.g. "N/A" or "3980.7")
  FAKE_FF_LOG        if set, append one line per invocation (argv) to this file
"""

import os
import sys
import time


def main() -> int:
    mode = sys.argv[1]  # "ffmpeg" | "ffprobe"
    args = sys.argv[2:]

    log = os.environ.get("FAKE_FF_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(mode + " " + " ".join(args) + "\n")

    sleep = float(os.environ.get("FAKE_FF_SLEEP", "0"))
    if sleep:
        time.sleep(sleep)

    if mode == "ffprobe":
        sys.stdout.write(os.environ.get("FAKE_FF_PROBE_OUT", "N/A") + "\n")
        return 0

    # ffmpeg: output path is always the last argument
    out_path = args[-1]
    size = int(os.environ.get("FAKE_FF_OUT_BYTES", "1024"))
    with open(out_path, "wb") as f:
        f.truncate(size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
