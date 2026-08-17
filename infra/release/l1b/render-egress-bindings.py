#!/usr/bin/env python3

import argparse
import hashlib
import ipaddress
import json
import pathlib
import re
import socket


DIRECTORY = pathlib.Path(__file__).resolve().parent
BEGIN_MARKER = "# BEGIN LLM MACHINES VM103-L1B EGRESS BINDING"
END_MARKER = "# END LLM MACHINES VM103-L1B EGRESS BINDING"


def load_and_validate(resolution_path: pathlib.Path) -> tuple[dict, dict]:
    policy_bytes = (DIRECTORY / "egress-allowlist.json").read_bytes()
    policy = json.loads(policy_bytes)
    resolution = json.loads(resolution_path.read_text(encoding="utf-8"))
    expected_hash = f"sha256:{hashlib.sha256(policy_bytes).hexdigest()}"
    if (
        resolution.get("schema") != "llm-machines.vm103-l1b-egress-resolution.v2"
        or resolution.get("policySha256") != expected_hash
        or resolution.get("dnsResolver") != policy["dnsResolver"]
        or sorted(resolution.get("resolutions", {}).keys()) != policy["hosts"]
    ):
        raise RuntimeError("egress resolution does not bind the exact allowlist")
    for host in policy["hosts"]:
        addresses = resolution["resolutions"][host]
        if (
            not isinstance(addresses, list)
            or not addresses
            or addresses != sorted(set(addresses))
        ):
            raise RuntimeError(f"{host} resolution is invalid or non-canonical")
        for address in addresses:
            if not isinstance(address, str):
                raise RuntimeError(f"{host} resolution is invalid or non-canonical")
            ipaddress.IPv4Address(address)
    return policy, resolution


def hosts_binding(policy: dict, resolution: dict) -> str:
    lines = [BEGIN_MARKER]
    for host in policy["hosts"]:
        for address in resolution["resolutions"][host]:
            lines.append(f"{address} {host}")
    lines.append(END_MARKER)
    return "\n".join(lines) + "\n"


def dnsmasq_binding(
    policy: dict, resolution: dict, interface: str, listen_address: str
) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", interface):
        raise RuntimeError("dnsmasq interface is invalid")
    ipaddress.IPv4Address(listen_address)
    lines = [
        "no-resolv",
        "no-hosts",
        "cache-size=0",
        "no-negcache",
        "domain-needed",
        "bogus-priv",
        "bind-interfaces",
        f"interface={interface}",
        f"listen-address={listen_address}",
        "port=53",
    ]
    for host in policy["hosts"]:
        addresses = ",".join(resolution["resolutions"][host])
        lines.append(f"host-record={host},{addresses}")
    return "\n".join(lines) + "\n"


def verify_system_hosts(policy: dict, resolution: dict) -> None:
    nsswitch = pathlib.Path("/etc/nsswitch.conf").read_text(encoding="utf-8")
    hosts_line = next(
        (line for line in nsswitch.splitlines() if line.strip().startswith("hosts:")),
        "",
    )
    services = [
        token
        for token in hosts_line.split(":", 1)[-1].split()
        if not token.startswith("[")
    ]
    if not services or services[0] != "files":
        raise RuntimeError("NSS hosts lookup is not files-first")
    for host in policy["hosts"]:
        observed = sorted(
            {
                item[4][0]
                for item in socket.getaddrinfo(host, 443, socket.AF_INET)
            }
        )
        if observed != resolution["resolutions"][host]:
            raise RuntimeError(f"system resolver differs for {host}")


def write_exclusive(path: pathlib.Path, content: str) -> None:
    with path.open("x", encoding="utf-8") as output:
        output.write(content)
    path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resolution", required=True, type=pathlib.Path)
    parser.add_argument("--format", choices=("hosts", "dnsmasq", "verify-system"), required=True)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--interface")
    parser.add_argument("--listen-address")
    arguments = parser.parse_args()
    policy, resolution = load_and_validate(arguments.resolution)
    if arguments.format == "verify-system":
        if arguments.output or arguments.interface or arguments.listen_address:
            raise RuntimeError("verify-system accepts no output or network arguments")
        verify_system_hosts(policy, resolution)
        return
    if not arguments.output:
        raise RuntimeError("rendering requires --output")
    if arguments.format == "hosts":
        if arguments.interface or arguments.listen_address:
            raise RuntimeError("hosts rendering accepts no network arguments")
        write_exclusive(arguments.output, hosts_binding(policy, resolution))
        return
    if not arguments.interface or not arguments.listen_address:
        raise RuntimeError("dnsmasq rendering requires interface and listen address")
    write_exclusive(
        arguments.output,
        dnsmasq_binding(
            policy, resolution, arguments.interface, arguments.listen_address
        ),
    )


if __name__ == "__main__":
    main()
