"""Exercise a decision-review directory or tarball in an isolated, installed DSH host."""

import argparse
import base64
from http.client import HTTPConnection
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from uuid import uuid4
from xml.etree import ElementTree


PACKAGE_NAME = "@local/decision-review"
ROW_ID = "decision-review"
API_PATH = "/api/decision-review"
LAUNCH_URL = re.compile(r"dsh web: (http://127\.0\.0\.1:[1-9]\d*/\?token=[A-Za-z0-9_-]+)")
BOOT_GRAPH = re.compile(r'globalThis\["__DSH_BOOT__"\] = (\{.+?\})</script>')


class VerificationError(Exception):
    pass


def check(condition, message):
    if not condition:
        raise VerificationError(message)


def isolated_environment(root):
    home = root / "home"
    home.mkdir()
    return {
        "HOME": str(home),
        "PATH": os.environ.get("PATH", os.defpath),
        "TMPDIR": str(root),
        "DSH_HOME": str(root / "dsh"),
        "DSH_AGENTS_HOME": str(root / "agents"),
        "DSH_TELEMETRY_DISABLED": "1",
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"),
        "NPM_CONFIG_USERCONFIG": os.devnull,
        "NPM_CONFIG_GLOBALCONFIG": os.devnull,
        "DEEPSEEK_API_KEY": "synthetic-no-model-calls",
        "DEEPSEEK_BASE_URL": "http://127.0.0.1:1",
    }


def wait_for_launch(process, log_path):
    deadline = time.monotonic() + 30
    while True:
        output = log_path.read_text(encoding="utf-8", errors="replace")
        launch = LAUNCH_URL.search(output)
        if launch is not None:
            return urlsplit(launch[1])
        if process.poll() is not None or time.monotonic() >= deadline:
            sanitized = re.sub(r"token=[A-Za-z0-9_-]+", "token=REDACTED", output)
            raise VerificationError(f"Web host did not report readiness\n{sanitized[-6000:]}")
        time.sleep(0.1)


def request(launch, path, *, cookie="", payload=None):
    connection = HTTPConnection(launch.hostname, launch.port, timeout=5)
    headers = {"Origin": f"{launch.scheme}://{launch.netloc}"}
    if cookie:
        headers["Cookie"] = cookie
    try:
        if payload is None:
            connection.request("GET", path, headers=headers)
        else:
            headers["Content-Type"] = "application/json"
            connection.request("POST", path, body=json.dumps(payload), headers=headers)
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


def open_browser_session(launch):
    status, headers, _ = request(launch, f"{launch.path}?{launch.query}")
    check(300 <= status < 400, f"Browser sign-in returned HTTP {status}")
    cookies = SimpleCookie()
    for header in headers.get_all("Set-Cookie", []):
        cookies.load(header)
    check(bool(cookies), "Browser sign-in issued no cookie")
    return "; ".join(cookie.OutputString(attrs=[]) for cookie in cookies.values())


def verify_client(launch, cookie):
    status, _, html = request(launch, "/", cookie=cookie)
    check(status == 200, f"Authenticated Web shell returned HTTP {status}")
    match = BOOT_GRAPH.search(html.decode())
    check(match is not None, "Web shell did not include a boot graph")
    graph = json.loads(match[1])
    entry = next((entry for entry in graph["entries"] if entry["id"] == PACKAGE_NAME), None)
    check(entry is not None, "Boot graph did not include the installed plugin")
    client_url = urlsplit(entry["url"])
    check(not client_url.scheme and not client_url.netloc, "Client resource URL was not local")
    resource_path = "/" + client_url.geturl().lstrip("/")
    status, _, client = request(launch, resource_path, cookie=cookie)
    check(status == 200 and b"window.__ModuleLoader__.load" in client,
          f"Client resource did not serve a ModuleLoader factory (HTTP {status})")
    release = graph.get("release", {})
    print(f"Web Host {release.get('version', 'unknown')} ({release.get('commit', 'unknown commit')}): served Client factory")


def verify_routes(launch, cookie):
    config_path = f"{API_PATH}/config"
    status, _, _ = request(launch, config_path)
    check(status == 401, f"Unauthenticated config returned HTTP {status}, expected 401")

    status, headers, body = request(launch, config_path, cookie=cookie)
    check(status == 200 and headers.get("Cache-Control") == "no-store",
          f"Authenticated config did not return uncached settings (HTTP {status})")
    settings = json.loads(body)["settings"]
    check(settings.get("hasApiKey") is False and "apiKey" not in settings,
          "Fresh settings did not report an absent, write-only key")

    status, _, body = request(launch, f"{API_PATH}/save", cookie=cookie,
                              payload={"settings": {"timeoutMs": 5200}})
    check(status == 200 and json.loads(body).get("ok") is True,
          f"Authenticated save returned HTTP {status}")
    status, _, body = request(launch, config_path, cookie=cookie)
    check(status == 200 and json.loads(body)["settings"]["timeoutMs"] == 5200,
          "The synthetic settings update was not readable")
    print("Authenticated settings read and save passed")


def verify_metadata(metadata, subject):
    check(isinstance(metadata, dict) and not metadata.get("error"),
          f"Host did not resolve metadata for {subject}")
    for field in ("title", "description"):
        translations = metadata.get(field)
        check(isinstance(translations, dict) and all(translations.get(lang) for lang in ("en", "zh")),
              f"Host did not resolve English and Chinese {field} for {subject}")
    prefix = "data:image/svg+xml;base64,"
    icon = metadata.get("icon", "")
    check(icon.startswith(prefix), f"Host did not resolve an SVG icon for {subject}")
    svg = ElementTree.fromstring(base64.b64decode(icon[len(prefix):], validate=True))
    check(svg.tag == "{http://www.w3.org/2000/svg}svg", f"Host icon for {subject} is not SVG")


def verify_inventory(launch, cookie):
    method = "pluginManager/listBundles"
    rpc_id = str(uuid4())
    status, _, body = request(launch, f"/api/{method}", cookie=cookie, payload={
        "type": "client-request",
        "rpcId": rpc_id,
        "method": method,
        "payload": {"args": {}},
    })
    check(status == 200, f"Authenticated plugin inventory returned HTTP {status}")
    response = json.loads(body)
    check(response.get("rpcId") == rpc_id and response.get("result", {}).get("ok") is True,
          "Host rejected the authenticated plugin inventory RPC")
    bundle = next((item for item in response["result"]["value"] if item["name"] == PACKAGE_NAME), None)
    check(bundle is not None and bundle.get("installed") and bundle.get("enabled") and not bundle.get("error"),
          "Host inventory did not report an enabled, installed bundle")
    row = next((item for item in bundle["rows"] if item["rowId"] == ROW_ID), None)
    check(row is not None and row.get("entryId") and row.get("moduleName") == PACKAGE_NAME,
          "Host inventory did not report a live plugin row")
    verify_metadata(bundle.get("meta"), "bundle")
    verify_metadata(row.get("meta"), "plugin row")
    print("Host inventory resolved the active row, English and Chinese metadata, and SVG icon")


def verify_host(dsh, bundle, root, browser=False):
    environment = isolated_environment(root)
    if bundle.is_dir():
        shutil.copytree(bundle, root / "dist")
        spec = "./dist"
        source = "copied bundle directory"
    else:
        spec = str(bundle)
        source = "bundle tarball"
    install = subprocess.run(
        [dsh, "plugin", "--profile", "web", "add", spec, "--offline", "--ignore-scripts"],
        cwd=root, env=environment, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
    )
    check(install.returncode == 0, f"Offline installation of {source} failed\n{install.stdout}{install.stderr}")
    print(f"Installed {source} offline in an isolated DSH profile")
    log_path = root / "web.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [dsh, "--profile", "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
            cwd=root, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
        )
        try:
            launch = wait_for_launch(process, log_path)
            cookie = open_browser_session(launch)
            verify_client(launch, cookie)
            verify_routes(launch, cookie)
            verify_inventory(launch, cookie)
            if browser:
                source_root = Path(__file__).resolve().parents[1]
                subprocess.run(
                    ["bun", "--no-env-file", "scripts/verify-rules-host.mjs"],
                    input=json.dumps({"url": f"{launch.scheme}://{launch.netloc}", "cookie": cookie}), text=True, cwd=source_root,
                    env=environment, check=True, timeout=120,
                )
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path, help="built dist directory or decision-review tarball")
    parser.add_argument("--dsh", default="dsh", help="installed DSH executable (default: dsh on PATH)")
    parser.add_argument("--browser", action="store_true", help="also verify rules in an isolated Chrome browser")
    args = parser.parse_args()
    dsh = shutil.which(args.dsh)
    if dsh is None:
        parser.error(f"DSH executable not found: {args.dsh}")
    bundle = args.bundle.resolve()
    if not bundle.is_file() and not (bundle / "package.json").is_file():
        parser.error(f"Tarball or package directory not found: {bundle}")
    try:
        with tempfile.TemporaryDirectory(prefix="dsh-decision-review-") as directory:
            verify_host(str(Path(dsh).absolute()), bundle, Path(directory), args.browser)
    except (VerificationError, OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError, KeyError) as error:
        parser.exit(1, f"Host verification failed: {error}\n")


if __name__ == "__main__":
    main()
