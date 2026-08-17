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
ACTIVE_VM118_FIREWALL = pathlib.Path("/etc/pve/firewall/118.fw")


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


def sha256(path: pathlib.Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def transaction_firewall(policy: dict, resolution: dict, profile: dict) -> str:
    by_address = {}
    for host in policy["hosts"]:
        for address in resolution["resolutions"][host]:
            by_address[address] = host
    lines = [
        "[OPTIONS]",
        "enable: 1",
        "policy_in: DROP",
        "policy_out: DROP",
        "log_level_in: warning",
        "log_level_out: warning",
        "",
        "[IPSET llmm-l1b-egress]",
    ]
    for address in sorted(
        by_address, key=lambda value: tuple(int(part) for part in value.split("."))
    ):
        lines.append(f"{address} # {by_address[address]}")
    lines.extend(
        [
            "",
            "[RULES]",
            f"IN ACCEPT -source {profile['network']['operatorSsh']['sourceCidr']} -p tcp -dport 22 -log nolog",
            "IN ACCEPT -source 10.33.74.1 -p udp -sport 67 -dport 68 -log nolog",
            "OUT ACCEPT -dest 255.255.255.255 -p udp -sport 68 -dport 67 -log nolog",
            f"OUT ACCEPT -dest {policy['dnsResolver']} -p udp -dport 53 -log nolog",
            f"OUT ACCEPT -dest {policy['dnsResolver']} -p tcp -dport 53 -log nolog",
            f"OUT ACCEPT -dest {policy['dnsResolver']} -p udp -dport 123 -log nolog",
            "OUT ACCEPT -dest +llmm-l1b-egress -p tcp -dport 443 -log nolog",
            "",
        ]
    )
    return "\n".join(lines)


def verify_transaction(transaction_directory: pathlib.Path) -> dict:
    expected_names = ["egress-resolution.json", "transaction.json", "vm118.firewall"]
    if sorted(path.name for path in transaction_directory.iterdir()) != expected_names:
        raise RuntimeError("egress transaction inventory is not exact")
    resolution_path = transaction_directory / "egress-resolution.json"
    firewall_path = transaction_directory / "vm118.firewall"
    manifest_path = transaction_directory / "transaction.json"
    for path in (resolution_path, firewall_path, manifest_path):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("egress transaction contains a non-regular file")
    policy, resolution = load_and_validate(resolution_path)
    profile_path = DIRECTORY / "builder-profile.json"
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if list(manifest.keys()) != [
        "schema",
        "vmid",
        "policySha256",
        "profileSha256",
        "resolutionSha256",
        "firewallSha256",
    ]:
        raise RuntimeError("egress transaction manifest is invalid")
    if (
        manifest["schema"] != "llm-machines.vm103-l1b-egress-transaction.v1"
        or manifest["vmid"] != 118
        or manifest["policySha256"]
        != f"sha256:{hashlib.sha256((DIRECTORY / 'egress-allowlist.json').read_bytes()).hexdigest()}"
        or manifest["profileSha256"] != sha256(profile_path)
        or manifest["resolutionSha256"] != sha256(resolution_path)
        or manifest["firewallSha256"] != sha256(firewall_path)
    ):
        raise RuntimeError("egress transaction hash binding failed")
    if firewall_path.read_text(encoding="utf-8") != transaction_firewall(
        policy, resolution, profile
    ):
        raise RuntimeError("egress transaction firewall differs from resolution")
    return manifest


def verify_firewall_receipt(
    transaction_directory: pathlib.Path, receipt_path: pathlib.Path
) -> None:
    manifest = verify_transaction(transaction_directory)
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise RuntimeError("installed firewall receipt is not a regular file")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if list(receipt.keys()) != [
        "schema",
        "status",
        "vmid",
        "transactionManifestSha256",
        "installedFirewallSha256",
    ]:
        raise RuntimeError("installed firewall receipt is invalid")
    transaction_manifest_sha256 = sha256(transaction_directory / "transaction.json")
    if (
        receipt["schema"] != "llm-machines.vm103-l1b-firewall-receipt.v1"
        or receipt["status"] != "INSTALLED_FIREWALL_VERIFIED"
        or receipt["vmid"] != 118
        or receipt["transactionManifestSha256"] != transaction_manifest_sha256
        or receipt["installedFirewallSha256"] != manifest["firewallSha256"]
    ):
        raise RuntimeError("installed firewall receipt differs from the transaction")


def create_firewall_receipt(
    transaction_directory: pathlib.Path,
    receipt_output: pathlib.Path,
    active_firewall: pathlib.Path = ACTIVE_VM118_FIREWALL,
) -> None:
    manifest = verify_transaction(transaction_directory)
    expected_firewall = transaction_directory / "vm118.firewall"
    if (
        not active_firewall.is_file()
        or active_firewall.is_symlink()
        or active_firewall.read_bytes() != expected_firewall.read_bytes()
        or sha256(active_firewall) != manifest["firewallSha256"]
    ):
        raise RuntimeError("active VM118 firewall differs from the transaction")
    receipt = {
        "schema": "llm-machines.vm103-l1b-firewall-receipt.v1",
        "status": "INSTALLED_FIREWALL_VERIFIED",
        "vmid": 118,
        "transactionManifestSha256": sha256(
            transaction_directory / "transaction.json"
        ),
        "installedFirewallSha256": manifest["firewallSha256"],
    }
    with receipt_output.open("x", encoding="utf-8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")
    receipt_output.chmod(0o600)


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
    parser.add_argument("--resolution", type=pathlib.Path)
    parser.add_argument(
        "--format",
        choices=(
            "hosts",
            "dnsmasq",
            "verify-system",
            "verify-transaction",
            "create-firewall-receipt",
        ),
        required=True,
    )
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--interface")
    parser.add_argument("--listen-address")
    parser.add_argument("--transaction-directory", type=pathlib.Path)
    parser.add_argument("--firewall-receipt", type=pathlib.Path)
    parser.add_argument("--receipt-output", type=pathlib.Path)
    arguments = parser.parse_args()
    if arguments.format == "create-firewall-receipt":
        if (
            not arguments.transaction_directory
            or not arguments.receipt_output
            or arguments.output
            or arguments.interface
            or arguments.listen_address
            or arguments.resolution
            or arguments.firewall_receipt
        ):
            raise RuntimeError("firewall receipt creation arguments are invalid")
        create_firewall_receipt(
            arguments.transaction_directory, arguments.receipt_output
        )
        return
    if arguments.format == "verify-transaction":
        if (
            not arguments.transaction_directory
            or arguments.output
            or arguments.interface
            or arguments.listen_address
            or arguments.resolution
            or not arguments.firewall_receipt
            or arguments.receipt_output
        ):
            raise RuntimeError("transaction verification accepts no rendering output")
        verify_firewall_receipt(
            arguments.transaction_directory, arguments.firewall_receipt
        )
        return
    if (
        arguments.transaction_directory
        or arguments.firewall_receipt
        or arguments.receipt_output
        or not arguments.resolution
    ):
        raise RuntimeError("rendering and system verification require one resolution")
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
