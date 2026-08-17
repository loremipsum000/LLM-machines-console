#!/usr/bin/env python3

import argparse
import hashlib
import ipaddress
import json
import pathlib
import subprocess


DIRECTORY = pathlib.Path(__file__).resolve().parent


def resolve_hosts(policy_bytes: bytes, dig_path: pathlib.Path) -> dict:
    policy = json.loads(policy_bytes)
    resolver = policy["dnsResolver"]
    resolutions = {}
    for host in policy["hosts"]:
        result = subprocess.run(
            [
                str(dig_path),
                "+time=5",
                "+tries=2",
                "+short",
                f"@{resolver}",
                "A",
                host,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        addresses = sorted(
            {
                str(ipaddress.IPv4Address(line.strip()))
                for line in result.stdout.splitlines()
                if line.strip() and not line.strip().endswith(".")
            },
            key=lambda value: tuple(int(part) for part in value.split(".")),
        )
        if not addresses:
            raise RuntimeError(f"{host} has no IPv4 address")
        resolutions[host] = addresses
    return {
        "schema": "llm-machines.vm103-l1b-egress-resolution.v2",
        "policySha256": f"sha256:{hashlib.sha256(policy_bytes).hexdigest()}",
        "dnsResolver": resolver,
        "resolutions": resolutions,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--dig", default="/usr/bin/dig", type=pathlib.Path)
    arguments = parser.parse_args()
    policy_bytes = (DIRECTORY / "egress-allowlist.json").read_bytes()
    document = resolve_hosts(policy_bytes, arguments.dig)
    with arguments.output.open("x", encoding="utf-8") as output:
        json.dump(document, output, sort_keys=True, separators=(",", ":"))
        output.write("\n")
    arguments.output.chmod(0o600)


if __name__ == "__main__":
    main()
